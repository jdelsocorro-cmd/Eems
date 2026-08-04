import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.completion import CompletionEvidenceLink as CompletionEvidenceLinkModel
from app.models.completion import CompletionSubmission as CompletionSubmissionModel
from app.models.completion import KpiMilestone, KpiProject, KpiTask
from app.models.goal import Kpi as KpiModel
from app.schemas.completion import CompletionSubmissionCreate


async def create_submission(
    db: AsyncSession, entity_type: str, entity_id: uuid.UUID, submitted_by: uuid.UUID, payload: CompletionSubmissionCreate
) -> CompletionSubmissionModel:
    """Shared by the submit-completion endpoint on tasks/projects/milestones
    -- identical shape regardless of entity type, so it lives here once
    rather than being copy-pasted into three routers.
    """
    submission = CompletionSubmissionModel(
        entity_type=entity_type,
        entity_id=entity_id,
        submitted_by=submitted_by,
        summary=payload.summary,
    )
    db.add(submission)
    await db.flush()

    for link in payload.evidence_links:
        db.add(
            CompletionEvidenceLinkModel(
                submission_id=submission.id,
                url=link.url,
                label=link.label,
                added_by=submitted_by,
            )
        )
    await db.flush()
    await db.refresh(submission)
    return submission

# Recompute happens through the normal RLS-scoped connection (no SECURITY
# DEFINER bypass) -- kpis_update already has a legitimate client path
# (kpi.update_value / kpi.update_target on the KPI's own employee_id), so
# this deliberately does NOT bypass it the way compute_and_snapshot_score
# bypasses kpi_scores (which has no client INSERT policy at all). If the
# approver doesn't separately hold rights on the KPI's employee, the UPDATE
# below simply affects zero rows -- see approve_submission()'s handling of
# that case rather than silently failing or escalating privilege.


async def _latest_approved_score(db: AsyncSession, entity_type: str, entity_id: uuid.UUID) -> float | None:
    result = await db.execute(
        select(CompletionSubmissionModel.completion_score)
        .where(
            CompletionSubmissionModel.entity_type == entity_type,
            CompletionSubmissionModel.entity_id == entity_id,
            CompletionSubmissionModel.status == "approved",
        )
        .order_by(CompletionSubmissionModel.reviewed_at.desc())
        .limit(1)
    )
    row = result.first()
    return float(row[0]) if row and row[0] is not None else None


async def _recompute_kpi_current_value(db: AsyncSession, kpi_id: uuid.UUID) -> bool:
    """Weighted average of every linked task/project/milestone's latest
    approved completion_score, across all three link tables at once (a KPI
    can be backed by any mix of the three). Returns True if the KPI row was
    actually updated (RLS may silently block it -- see module docstring).
    """
    total_weight = 0.0
    weighted_sum = 0.0

    task_links = await db.execute(select(KpiTask.task_id, KpiTask.weight).where(KpiTask.kpi_id == kpi_id))
    for task_id, weight in task_links.all():
        score = await _latest_approved_score(db, "task", task_id)
        if score is not None:
            weighted_sum += score * float(weight)
            total_weight += float(weight)

    project_links = await db.execute(select(KpiProject.project_id, KpiProject.weight).where(KpiProject.kpi_id == kpi_id))
    for project_id, weight in project_links.all():
        score = await _latest_approved_score(db, "project", project_id)
        if score is not None:
            weighted_sum += score * float(weight)
            total_weight += float(weight)

    milestone_links = await db.execute(
        select(KpiMilestone.milestone_id, KpiMilestone.weight).where(KpiMilestone.kpi_id == kpi_id)
    )
    for milestone_id, weight in milestone_links.all():
        score = await _latest_approved_score(db, "milestone", milestone_id)
        if score is not None:
            weighted_sum += score * float(weight)
            total_weight += float(weight)

    if total_weight <= 0:
        return False

    kpi = await db.get(KpiModel, kpi_id)
    if kpi is None:
        return False

    kpi.current_value = round(weighted_sum / total_weight, 2)
    await db.flush()
    return True


async def recompute_linked_kpis(db: AsyncSession, entity_type: str, entity_id: uuid.UUID) -> list[uuid.UUID]:
    """Called after an approval. Finds every KPI linked to this entity and
    recomputes each one. Returns the KPI ids that were actually updated
    (not just linked) -- used by the approve endpoint to decide whether to
    surface a "the linked KPI wasn't updated -- you may not have rights to
    it" note, and as input to the recognition-threshold check.
    """
    if entity_type == "task":
        result = await db.execute(select(KpiTask.kpi_id).where(KpiTask.task_id == entity_id))
    elif entity_type == "project":
        result = await db.execute(select(KpiProject.kpi_id).where(KpiProject.project_id == entity_id))
    else:
        result = await db.execute(select(KpiMilestone.kpi_id).where(KpiMilestone.milestone_id == entity_id))

    kpi_ids = {row[0] for row in result.all()}
    updated_ids = []
    for kpi_id in kpi_ids:
        if await _recompute_kpi_current_value(db, kpi_id):
            updated_ids.append(kpi_id)
    return updated_ids


async def get_responsible_employee_id(db: AsyncSession, entity_type: str, entity_id: uuid.UUID) -> uuid.UUID | None:
    """The person accountable for the work being reviewed -- task assignee,
    or project/milestone owner. Used to resolve which company's
    recognition_score_threshold applies (employees have no direct
    company_id -- see 014_employee_created_by_visibility.sql -- so this
    also drives the company lookup in the approve endpoint).
    """
    if entity_type == "task":
        result = await db.execute(text("select assignee_employee_id from tasks where id = :id"), {"id": str(entity_id)})
    elif entity_type == "project":
        result = await db.execute(text("select owner_employee_id from projects where id = :id"), {"id": str(entity_id)})
    else:
        result = await db.execute(
            text("""
                select p.owner_employee_id from milestones m
                join projects p on p.id = m.project_id
                where m.id = :id
            """),
            {"id": str(entity_id)},
        )
    row = result.first()
    return row[0] if row else None


async def get_employee_company_id(db: AsyncSession, employee_id: uuid.UUID) -> uuid.UUID | None:
    result = await db.execute(
        text("""
            select ou.company_id
            from position_assignments pa
            join positions p on p.id = pa.position_id
            join org_units ou on ou.id = p.org_unit_id
            where pa.employee_id = :employee_id and pa.end_date is null and pa.is_primary
            limit 1
        """),
        {"employee_id": str(employee_id)},
    )
    row = result.first()
    return row[0] if row else None
