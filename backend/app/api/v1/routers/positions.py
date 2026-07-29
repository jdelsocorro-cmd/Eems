import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.org import Position as PositionModel
from app.schemas.org import Position, PositionCreate, PositionReparent, PositionUpdate

router = APIRouter(prefix="/positions", tags=["positions"])


@router.get("", response_model=list[Position])
async def list_positions(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[PositionModel]:
    result = await db.execute(select(PositionModel).where(PositionModel.deleted_at.is_(None)))
    return list(result.scalars().all())


@router.get("/{position_id}", response_model=Position)
async def get_position(
    position_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> PositionModel:
    position = await db.get(PositionModel, position_id)
    if position is None or position.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")
    return position


@router.get("/{position_id}/subtree", response_model=list[Position])
async def get_position_subtree(
    position_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[PositionModel]:
    """Every position at or below this one in the reporting line, via the
    position_closure table -- an indexed lookup, not a recursive walk.
    RLS still applies on top of this (positions_select), so the result is
    naturally limited to positions in the caller's own company.
    """
    result = await db.execute(
        text("""
            select p.* from positions p
            join position_closure pc on pc.descendant_position_id = p.id
            where pc.ancestor_position_id = :position_id
              and p.deleted_at is null
            order by pc.depth, p.title
        """),
        {"position_id": str(position_id)},
    )
    rows = result.mappings().all()
    return [Position(**row) for row in rows]


@router.post("", response_model=Position, status_code=status.HTTP_201_CREATED)
async def create_position(
    payload: PositionCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> PositionModel:
    """reports_to_position_id is allowed here (unlike PATCH) because a brand
    new position has no prior history to preserve -- there's nothing to
    audit yet, so setting the initial reporting line isn't a "reparent."
    """
    position = PositionModel(**payload.model_dump())
    db.add(position)
    try:
        await db.flush()
    except DBAPIError as exc:
        if "cycle" in str(exc.orig).lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc.orig)) from exc
        raise
    await db.refresh(position)
    return position


@router.patch("/{position_id}", response_model=Position)
async def update_position(
    position_id: uuid.UUID,
    payload: PositionUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> PositionModel:
    position = await db.get(PositionModel, position_id)
    if position is None or position.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(position, field, value)

    await db.flush()
    await db.refresh(position)
    return position


@router.post("/{position_id}/reparent", response_model=Position)
async def reparent_position(
    position_id: uuid.UUID,
    payload: PositionReparent,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> PositionModel:
    """Changes reports_to_position_id -- distinct from a normal field edit
    because app.maintain_position_closure() (a DB trigger) atomically
    rebuilds position_closure for the whole affected subtree, rejects the
    change if it would create a cycle, and writes a
    position_hierarchy_history row, so this action can never happen without
    leaving an audit trail (see supabase/migrations/001_org_hierarchy.sql
    and 009_position_reparent_reason.sql).
    """
    position = await db.get(PositionModel, position_id)
    if position is None or position.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    if payload.new_reports_to_position_id is not None:
        new_parent = await db.get(PositionModel, payload.new_reports_to_position_id)
        if new_parent is None or new_parent.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target parent position not found")

    await db.execute(
        text("select set_config('app.reparent_reason', :reason, true)"),
        {"reason": payload.reason or ""},
    )

    position.reports_to_position_id = payload.new_reports_to_position_id
    try:
        await db.flush()
    except DBAPIError as exc:
        if "cycle" in str(exc.orig).lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc.orig)) from exc
        raise
    await db.refresh(position)
    return position


@router.delete("/{position_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_position(
    position_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> None:
    position = await db.get(PositionModel, position_id)
    if position is None or position.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Position not found")

    position.deleted_at = datetime.now(timezone.utc)
    position.is_active = False
    await db.flush()
