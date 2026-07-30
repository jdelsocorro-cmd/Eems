import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.goal import Goal as GoalModel
from app.schemas.goal import Goal, GoalCreate, GoalUpdate

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("", response_model=list[Goal])
async def list_goals(
    company_id: uuid.UUID | None = Query(default=None),
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[GoalModel]:
    stmt = select(GoalModel).where(GoalModel.deleted_at.is_(None))
    if company_id is not None:
        stmt = stmt.where(GoalModel.company_id == company_id)
    if employee_id is not None:
        stmt = stmt.where(GoalModel.employee_id == employee_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{goal_id}", response_model=Goal)
async def get_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> GoalModel:
    goal = await db.get(GoalModel, goal_id)
    if goal is None or goal.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return goal


@router.post("", response_model=Goal, status_code=status.HTTP_201_CREATED)
async def create_goal(
    payload: GoalCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> GoalModel:
    """No require_permission guard -- goals_mutate's own RLS policy
    (company-scoped goal.manage, 021_scope_aware_goals_kpi_templates_mutate.
    sql) is the actual authorization, same pattern as projects/roles.
    """
    goal = GoalModel(**payload.model_dump(), created_by=uuid.UUID(current.employee_id))
    db.add(goal)
    await db.flush()
    await db.refresh(goal)
    return goal


@router.patch("/{goal_id}", response_model=Goal)
async def update_goal(
    goal_id: uuid.UUID,
    payload: GoalUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> GoalModel:
    goal = await db.get(GoalModel, goal_id)
    if goal is None or goal.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    await db.flush()
    await db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_goal(
    goal_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    goal = await db.get(GoalModel, goal_id)
    if goal is None or goal.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")

    goal.deleted_at = datetime.now(timezone.utc)
    await db.flush()
