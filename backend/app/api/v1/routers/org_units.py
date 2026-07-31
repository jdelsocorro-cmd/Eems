import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.org import OrgUnit as OrgUnitModel
from app.schemas.org import OrgUnit, OrgUnitCreate, OrgUnitReparent, OrgUnitUpdate

router = APIRouter(prefix="/org-units", tags=["org-units"])


@router.get("", response_model=list[OrgUnit])
async def list_org_units(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[OrgUnitModel]:
    result = await db.execute(select(OrgUnitModel).where(OrgUnitModel.deleted_at.is_(None)))
    return list(result.scalars().all())


@router.get("/{org_unit_id}", response_model=OrgUnit)
async def get_org_unit(
    org_unit_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> OrgUnitModel:
    unit = await db.get(OrgUnitModel, org_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org unit not found")
    return unit


@router.get("/{org_unit_id}/subtree", response_model=list[OrgUnit])
async def get_org_unit_subtree(
    org_unit_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[OrgUnitModel]:
    """Every org unit at or below this one, via org_unit_closure -- an
    indexed lookup, not a recursive walk. Same pattern as
    GET /positions/{id}/subtree.
    """
    result = await db.execute(
        text("""
            select ou.* from org_units ou
            join org_unit_closure ouc on ouc.descendant_unit_id = ou.id
            where ouc.ancestor_unit_id = :org_unit_id
              and ou.deleted_at is null
            order by ouc.depth, ou.name
        """),
        {"org_unit_id": str(org_unit_id)},
    )
    rows = result.mappings().all()
    return [OrgUnit(**row) for row in rows]


@router.post("", response_model=OrgUnit, status_code=status.HTTP_201_CREATED)
async def create_org_unit(
    payload: OrgUnitCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> OrgUnitModel:
    """parent_unit_id is allowed here (unlike PATCH) because a brand new
    unit has no prior history to preserve -- see positions.create_position
    for the identical reasoning.
    """
    unit = OrgUnitModel(**payload.model_dump())
    db.add(unit)
    try:
        await db.flush()
    except DBAPIError as exc:
        if "cycle" in str(exc.orig).lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc.orig)) from exc
        raise
    await db.refresh(unit)
    return unit


@router.patch("/{org_unit_id}", response_model=OrgUnit)
async def update_org_unit(
    org_unit_id: uuid.UUID,
    payload: OrgUnitUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> OrgUnitModel:
    unit = await db.get(OrgUnitModel, org_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org unit not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(unit, field, value)

    await db.flush()
    await db.refresh(unit)
    return unit


@router.post("/{org_unit_id}/reparent", response_model=OrgUnit)
async def reparent_org_unit(
    org_unit_id: uuid.UUID,
    payload: OrgUnitReparent,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> OrgUnitModel:
    """Changes parent_unit_id -- distinct from a normal field edit because
    app.maintain_org_unit_closure() (a DB trigger, 024_org_units.sql)
    atomically rebuilds org_unit_closure for the whole affected subtree,
    rejects the change if it would create a cycle, and writes an
    org_unit_hierarchy_history row. Same pattern as
    POST /positions/{id}/reparent.
    """
    unit = await db.get(OrgUnitModel, org_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org unit not found")

    if payload.new_parent_unit_id is not None:
        new_parent = await db.get(OrgUnitModel, payload.new_parent_unit_id)
        if new_parent is None or new_parent.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target parent org unit not found")

    await db.execute(
        text("select set_config('app.reparent_reason', :reason, true)"),
        {"reason": payload.reason or ""},
    )

    unit.parent_unit_id = payload.new_parent_unit_id
    try:
        await db.flush()
    except DBAPIError as exc:
        if "cycle" in str(exc.orig).lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc.orig)) from exc
        raise
    await db.refresh(unit)
    return unit


@router.delete("/{org_unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_org_unit(
    org_unit_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> None:
    """Soft-delete only -- units with positions/history attached must never
    be hard-deleted.
    """
    unit = await db.get(OrgUnitModel, org_unit_id)
    if unit is None or unit.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Org unit not found")

    unit.deleted_at = datetime.now(timezone.utc)
    unit.is_active = False
    await db.flush()
