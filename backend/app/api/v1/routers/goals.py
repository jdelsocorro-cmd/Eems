import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.employee import Employee as EmployeeModel
from app.models.goal import Goal as GoalModel
from app.models.goal import Kpi as KpiModel
from app.models.goal import KpiTemplate as KpiTemplateModel
from app.schemas.goal import Goal, GoalCascadeRequest, GoalCascadeResult, GoalCreate, GoalUpdate

router = APIRouter(prefix="/goals", tags=["goals"])


@router.get("", response_model=list[Goal])
async def list_goals(
    company_id: uuid.UUID | None = Query(default=None),
    employee_id: uuid.UUID | None = Query(default=None),
    owner_employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[GoalModel]:
    stmt = select(GoalModel).where(GoalModel.deleted_at.is_(None))
    if company_id is not None:
        stmt = stmt.where(GoalModel.company_id == company_id)
    if employee_id is not None:
        stmt = stmt.where(GoalModel.employee_id == employee_id)
    if owner_employee_id is not None:
        stmt = stmt.where(GoalModel.owner_employee_id == owner_employee_id)
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


@router.post("/{goal_id}/cascade", response_model=GoalCascadeResult, status_code=status.HTTP_201_CREATED)
async def cascade_goal(
    goal_id: uuid.UUID,
    payload: GoalCascadeRequest,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> GoalCascadeResult:
    """Bulk-creates one individual goal per selected employee, linked via
    parent_goal_id, off a department (org_unit) goal -- the point being
    "adjust, don't retype" for a Department Head setting up their team's
    goals. Each generated Goal (and Kpi, if a template is given) ALSO goes
    through the exact same RLS this endpoint would hit if the manager
    created them one at a time via POST /goals and POST /kpis -- goals_
    mutate's has_permission_on_employee check for the individual-goal
    branch (046), kpis_insert's kpi.update_target check (006) for the KPI.
    If the caller isn't authorized for a given employee, that INSERT raises
    and the whole request rolls back (session.begin() wraps the request in
    one transaction, see db/session.py) -- nothing partially commits.

    The explicit has_permission_on_org_unit check below is a THIRD, separate
    authorization layer, not a substitute for the two above -- a security
    review found that without it, a caller could pass an arbitrary org_unit
    goal_id belonging to a department they don't manage (goals are broadly
    readable company-wide by design, so they can always look one up) and
    still successfully cascade against employees they DO manage, since the
    per-employee RLS check above never looks at which department the parent
    goal belongs to. That doesn't expose or modify any data outside the
    caller's real scope, but it does let them falsely attribute a generated
    goal's parent_goal_id/title to a department goal that isn't theirs to
    cascade from -- a data-integrity gap on the parent resource itself,
    which only this explicit check (not the per-child ones) can catch.
    """
    parent = await db.get(GoalModel, goal_id)
    if parent is None or parent.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    if parent.goal_type != "org_unit":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only an org-unit goal can be cascaded to a team")

    can_manage_parent = await db.execute(
        text("select app.has_permission_on_org_unit(:employee_id, :org_unit_id, 'goal', 'manage')"),
        {"employee_id": current.employee_id, "org_unit_id": str(parent.org_unit_id)},
    )
    if not can_manage_parent.scalar_one():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to cascade goals for this department",
        )

    template: KpiTemplateModel | None = None
    if payload.kpi_template_id is not None:
        template = await db.get(KpiTemplateModel, payload.kpi_template_id)
        if template is None or not template.is_active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI template not found")

    existing = await db.execute(
        select(GoalModel.employee_id).where(GoalModel.parent_goal_id == goal_id, GoalModel.deleted_at.is_(None))
    )
    already_covered = {row[0] for row in existing.all()}

    created: list[GoalModel] = []
    skipped: list[uuid.UUID] = []
    for employee_id in payload.employee_ids:
        # already_covered is updated as we go (not just seeded from the DB
        # once above) so a duplicate employee_id repeated within the same
        # payload is also caught here, gracefully, instead of surfacing as
        # a raw IntegrityError from uq_goals_parent_employee_active
        # (053_add_missing_indexes_and_dedup_constraints.sql) mid-request,
        # which would otherwise abort every goal already created in this
        # same transaction.
        if employee_id in already_covered:
            skipped.append(employee_id)
            continue

        employee = await db.get(EmployeeModel, employee_id)
        if employee is None or employee.deleted_at is not None:
            skipped.append(employee_id)
            continue

        child = GoalModel(
            company_id=parent.company_id,
            title=f"{parent.title} — {employee.first_name} {employee.last_name}",
            goal_type="individual",
            employee_id=employee_id,
            parent_goal_id=parent.id,
            period_start=parent.period_start,
            period_end=parent.period_end,
            status="draft",
            created_by=uuid.UUID(current.employee_id),
        )
        db.add(child)
        await db.flush()

        if template is not None:
            # chk_kpis_target_nonzero (005_goals_kpis.sql) forbids target_value
            # = 0 for higher_is_better/target_is_exact -- it's the score
            # formula's divisor for those directions, so 0 there isn't just
            # "unset", it's an invalid value the DB rejects outright. 0 is
            # only legitimate for lower_is_better ("zero defects" is a real
            # target). 1 is a placeholder either way -- the manager sets the
            # real number per employee afterward, same as the goal itself.
            placeholder_target = 0 if template.direction == "lower_is_better" else 1
            kpi = KpiModel(
                employee_id=employee_id,
                goal_id=child.id,
                kpi_template_id=template.id,
                name=template.name,
                unit=template.unit,
                direction=template.direction,
                target_value=placeholder_target,
                weight=template.default_weight,
                period_start=parent.period_start,
                period_end=parent.period_end,
                created_by=uuid.UUID(current.employee_id),
            )
            db.add(kpi)
            await db.flush()

        already_covered.add(employee_id)
        created.append(child)

    for goal in created:
        await db.refresh(goal)

    return GoalCascadeResult(created=created, skipped_employee_ids=skipped)


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
