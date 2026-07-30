import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.schemas.employee import PositionAssignment, PositionAssignmentCreate

router = APIRouter(prefix="/position-assignments", tags=["position-assignments"])


@router.get("", response_model=list[PositionAssignment])
async def list_position_assignments(
    position_id: uuid.UUID | None = Query(default=None),
    employee_id: uuid.UUID | None = Query(default=None),
    current_only: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[PositionAssignment]:
    conditions = []
    params: dict = {}
    if position_id is not None:
        conditions.append("position_id = :position_id")
        params["position_id"] = str(position_id)
    if employee_id is not None:
        conditions.append("employee_id = :employee_id")
        params["employee_id"] = str(employee_id)
    if current_only:
        conditions.append("end_date is null")

    where_clause = f"where {' and '.join(conditions)}" if conditions else ""
    result = await db.execute(
        text(f"""
            select id, position_id, employee_id, start_date, end_date, assignment_type, is_primary
            from position_assignments
            {where_clause}
            order by start_date desc
        """),
        params,
    )
    return [PositionAssignment(**row) for row in result.mappings().all()]


@router.post("", response_model=PositionAssignment, status_code=201)
async def assign_position(
    payload: PositionAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> PositionAssignment:
    """Assigning someone to a position closes (end_date = today) any
    current assignment they already hold elsewhere, and any current
    primary holder already on this position -- both position_assignments
    unique indexes (uq_position_assignments_current_primary,
    uq_position_assignments_current_employee, see
    supabase/migrations/001_org_hierarchy.sql) only allow ONE current row
    per position and per employee, so a plain INSERT without this close-out
    step would just fail the constraint instead of doing the reassignment
    the caller actually wants.
    """
    today = date.today()

    await db.execute(
        text("update position_assignments set end_date = :today where employee_id = :employee_id and end_date is null"),
        {"today": today, "employee_id": str(payload.employee_id)},
    )
    await db.execute(
        text(
            "update position_assignments set end_date = :today "
            "where position_id = :position_id and end_date is null and is_primary"
        ),
        {"today": today, "position_id": str(payload.position_id)},
    )

    result = await db.execute(
        text("""
            insert into position_assignments (position_id, employee_id, assignment_type, created_by)
            values (:position_id, :employee_id, :assignment_type, :created_by)
            returning id, position_id, employee_id, start_date, end_date, assignment_type, is_primary
        """),
        {
            "position_id": str(payload.position_id),
            "employee_id": str(payload.employee_id),
            "assignment_type": payload.assignment_type,
            "created_by": current.employee_id,
        },
    )
    row = result.mappings().one()
    return PositionAssignment(**row)


@router.post("/{assignment_id}/end", response_model=PositionAssignment)
async def end_position_assignment(
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> PositionAssignment:
    """Vacates a position without assigning a replacement -- e.g. the seat
    goes empty for a while before backfilling.
    """
    result = await db.execute(
        text("""
            update position_assignments
            set end_date = current_date
            where id = :id and end_date is null
            returning id, position_id, employee_id, start_date, end_date, assignment_type, is_primary
        """),
        {"id": str(assignment_id)},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active assignment not found")
    return PositionAssignment(**row)
