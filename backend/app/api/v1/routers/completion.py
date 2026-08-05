import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import CompletionEvidenceLink as CompletionEvidenceLinkModel
from app.models.completion import CompletionSubmission as CompletionSubmissionModel
from app.models.org import Company as CompanyModel
from app.schemas.completion import (
    CompletionEvidenceLink,
    CompletionSubmission,
    CompletionSubmissionApprove,
    CompletionSubmissionReject,
)
from app.services import completion_workflow

router = APIRouter(prefix="/completion-submissions", tags=["completion"])


@router.get("", response_model=list[CompletionSubmission])
async def list_completion_submissions(
    status_filter: str | None = Query(default=None, alias="status"),
    entity_type: str | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    awaiting_my_review: bool = Query(default=False),
    reviewed_by_me: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> list[CompletionSubmissionModel]:
    """No manual scoping here for the base case -- completion_submissions_
    select's own RLS (submitter, reviewer, or anyone who could see the
    underlying entity) already narrows this to exactly what the caller
    should see, the same "the query looks like select everything because
    RLS already scoped it" pattern list_companies uses.

    awaiting_my_review is different: RLS's broad SELECT visibility would
    also hand back the caller's OWN pending submissions (they can see what
    they submitted), which isn't what a review inbox should show. This
    mirrors completion_submissions_review's reviewer-eligibility branches
    exactly (same three entity_type checks, same has_permission_on_employee
    calls, same self-submission exclusion added in 037_block_self_approval.
    sql, same app.is_eligible_completion_reviewer() hierarchy-resolution
    call added in 038) so "what shows up in my review queue" and "what I'm
    actually allowed to approve" never drift apart -- still fully subject
    to RLS on top, this is a narrowing filter, not a bypass.

    reviewed_by_me is the mirror image, for Review Queue's "Recently
    Reviewed" history -- reviewed_by is only ever set by approve_completion/
    reject_completion (never client-writable directly), so filtering on it
    alone is sufficient; no separate status check needed.
    """
    stmt = select(CompletionSubmissionModel).order_by(CompletionSubmissionModel.submitted_at.desc())
    if status_filter is not None:
        stmt = stmt.where(CompletionSubmissionModel.status == status_filter)
    if entity_type is not None:
        stmt = stmt.where(CompletionSubmissionModel.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(CompletionSubmissionModel.entity_id == entity_id)
    if reviewed_by_me:
        # order_by(None) resets the submitted_at ordering set above -- this
        # view wants most-recently-REVIEWED first, not most-recently-submitted.
        stmt = (
            stmt.where(CompletionSubmissionModel.reviewed_by == uuid.UUID(current.employee_id))
            .order_by(None)
            .order_by(CompletionSubmissionModel.reviewed_at.desc())
        )
    if awaiting_my_review:
        stmt = (
            stmt.where(CompletionSubmissionModel.status == "pending")
            .where(CompletionSubmissionModel.submitted_by != uuid.UUID(current.employee_id))
            .where(
                text("""
                    (
                      (entity_type = 'task' and exists (
                        select 1 from tasks t where t.id = entity_id
                          and (t.assigner_employee_id = :me
                               or app.has_permission_on_employee(:me, t.assignee_employee_id, 'completion', 'review'))
                      ))
                      or (entity_type = 'project' and exists (
                        select 1 from projects p where p.id = entity_id
                          and app.has_permission_on_employee(:me, p.owner_employee_id, 'completion', 'review')
                      ))
                      or (entity_type = 'milestone' and exists (
                        select 1 from milestones m join projects p on p.id = m.project_id where m.id = entity_id
                          and app.has_permission_on_employee(:me, p.owner_employee_id, 'completion', 'review')
                      ))
                      or app.is_eligible_completion_reviewer(:me, entity_type, entity_id)
                    )
                """)
            )
            .params(me=current.employee_id)
        )
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{submission_id}/evidence-links", response_model=list[CompletionEvidenceLink])
async def list_evidence_links(
    submission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[CompletionEvidenceLinkModel]:
    result = await db.execute(
        select(CompletionEvidenceLinkModel).where(CompletionEvidenceLinkModel.submission_id == submission_id)
    )
    return list(result.scalars().all())


@router.post("/{submission_id}/approve", response_model=CompletionSubmission)
async def approve_completion(
    submission_id: uuid.UUID,
    payload: CompletionSubmissionApprove,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> CompletionSubmissionModel:
    """completion_submissions_review's own RLS (assigner, or completion.review
    scoped to the entity's responsible employee) is the real authorization
    here -- and its USING clause requiring status='pending' is what's
    *supposed* to make "approving twice" impossible. But completion_
    submissions_select is deliberately broader than _review (a reviewer can
    still see their own past approval via reviewed_by=self after the status
    has moved on) -- so a plain db.get()+setattr()+flush() would find the
    already-approved row, silently fail to re-apply the blocked UPDATE, and
    return 200 with stale data instead of erroring. RETURNING-then-check
    avoids that, the same fix roles.py/projects.py already apply to this
    exact failure class.
    """
    result = await db.execute(
        text("""
            update completion_submissions
            set status = 'approved', reviewed_by = :reviewer, reviewed_at = now(), completion_score = :score
            where id = :id
            returning id
        """),
        {"reviewer": current.employee_id, "score": payload.completion_score, "id": str(submission_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completion submission not found, already reviewed, or you don't have rights to review it",
        )

    submission = await db.get(CompletionSubmissionModel, submission_id)
    await completion_workflow.recompute_linked_kpis(db, submission.entity_type, submission.entity_id)
    await db.refresh(submission)
    return submission


@router.post("/{submission_id}/reject", response_model=CompletionSubmission)
async def reject_completion(
    submission_id: uuid.UUID,
    payload: CompletionSubmissionReject,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> CompletionSubmissionModel:
    """Rejection never touches any KPI -- only approval does (see
    approve_completion above), so the assignee's KPI evidence stays exactly
    as it was until they resubmit and get approved. Same RETURNING-then-
    check reasoning as approve_completion.
    """
    result = await db.execute(
        text("""
            update completion_submissions
            set status = 'rejected', reviewed_by = :reviewer, reviewed_at = now(), rejection_feedback = :feedback
            where id = :id
            returning id
        """),
        {"reviewer": current.employee_id, "feedback": payload.rejection_feedback, "id": str(submission_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Completion submission not found, already reviewed, or you don't have rights to review it",
        )

    submission = await db.get(CompletionSubmissionModel, submission_id)
    return submission


@router.get("/{submission_id}/recognition-suggested", response_model=bool)
async def is_recognition_suggested(
    submission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> bool:
    """Whether this (already-approved) submission's score crosses its
    company's recognition_score_threshold -- the frontend uses this to
    decide whether to show the dismissible "Recognize them for this?"
    prompt right after an approval. Never auto-creates a recognition; it
    only answers "should I ask."
    """
    submission = await db.get(CompletionSubmissionModel, submission_id)
    if submission is None or submission.completion_score is None:
        return False

    responsible_id = await completion_workflow.get_responsible_employee_id(db, submission.entity_type, submission.entity_id)
    if responsible_id is None:
        return False

    company_id = await completion_workflow.get_employee_company_id(db, responsible_id)
    if company_id is None:
        return False

    company = await db.get(CompanyModel, company_id)
    if company is None:
        return False

    return float(submission.completion_score) >= float(company.recognition_score_threshold)
