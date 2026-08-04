import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import CompletionSubmission as CompletionSubmissionModel
from app.models.completion import Milestone as MilestoneModel
from app.schemas.completion import (
    CompletionSubmission,
    CompletionSubmissionCreate,
    Milestone,
    MilestoneCreate,
    MilestoneUpdate,
)
from app.services import completion_workflow

router = APIRouter(prefix="/milestones", tags=["milestones"])


@router.get("", response_model=list[Milestone])
async def list_milestones(
    project_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[MilestoneModel]:
    stmt = select(MilestoneModel).where(MilestoneModel.deleted_at.is_(None))
    if project_id is not None:
        stmt = stmt.where(MilestoneModel.project_id == project_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=Milestone, status_code=status.HTTP_201_CREATED)
async def create_milestone(
    payload: MilestoneCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> MilestoneModel:
    """milestones_mutate's own RLS (parent project's owner, or
    project.update_all) is the real authorization -- same pattern as
    create_task/create_project.
    """
    milestone = MilestoneModel(**payload.model_dump(), created_by=uuid.UUID(current.employee_id))
    db.add(milestone)
    await db.flush()
    await db.refresh(milestone)
    return milestone


@router.patch("/{milestone_id}", response_model=Milestone)
async def update_milestone(
    milestone_id: uuid.UUID,
    payload: MilestoneUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> MilestoneModel:
    milestone = await db.get(MilestoneModel, milestone_id)
    if milestone is None or milestone.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(milestone, field, value)

    await db.flush()
    await db.refresh(milestone)
    return milestone


@router.delete("/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_milestone(
    milestone_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    milestone = await db.get(MilestoneModel, milestone_id)
    if milestone is None or milestone.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")

    milestone.deleted_at = datetime.now(timezone.utc)
    await db.flush()


@router.post("/{milestone_id}/submit-completion", response_model=CompletionSubmission, status_code=status.HTTP_201_CREATED)
async def submit_milestone_completion(
    milestone_id: uuid.UUID,
    payload: CompletionSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> CompletionSubmissionModel:
    return await completion_workflow.create_submission(
        db, "milestone", milestone_id, uuid.UUID(current.employee_id), payload
    )
