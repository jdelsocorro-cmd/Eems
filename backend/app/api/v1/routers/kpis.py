import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.goal import Kpi as KpiModel
from app.models.goal import KpiChangeLog as KpiChangeLogModel
from app.models.goal import KpiValueHistory as KpiValueHistoryModel
from app.schemas.goal import Kpi, KpiChangeLogEntry, KpiCreate, KpiUpdate, KpiValueHistoryEntry

router = APIRouter(prefix="/kpis", tags=["kpis"])

# Fields app.enforce_kpi_sensitive_changes() (005_goals_kpis.sql) gates
# behind kpi/update_target -- see that trigger for the exact rule this
# mirrors. Checked here so the client gets a clean, immediate 403 instead of
# discovering it only via the trigger's raised exception.
SENSITIVE_FIELDS = {"target_value", "weight", "direction"}


@router.get("", response_model=list[Kpi])
async def list_kpis(
    employee_id: uuid.UUID | None = Query(default=None),
    goal_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiModel]:
    stmt = select(KpiModel).where(KpiModel.deleted_at.is_(None))
    if employee_id is not None:
        stmt = stmt.where(KpiModel.employee_id == employee_id)
    if goal_id is not None:
        stmt = stmt.where(KpiModel.goal_id == goal_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{kpi_id}", response_model=Kpi)
async def get_kpi(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiModel:
    kpi = await db.get(KpiModel, kpi_id)
    if kpi is None or kpi.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return kpi


@router.post("", response_model=Kpi, status_code=status.HTTP_201_CREATED)
async def create_kpi(
    payload: KpiCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> KpiModel:
    """No pre-check needed -- kpis_insert's RLS WITH CHECK requires
    kpi/update_target on the target employee for every field, since defining
    a target/weight/direction is inherently the sensitive action; a bare RLS
    violation here already surfaces as a clean 403 via rls_violation_handler.
    """
    kpi = KpiModel(**payload.model_dump(), created_by=uuid.UUID(current.employee_id))
    db.add(kpi)
    await db.flush()
    await db.refresh(kpi)
    return kpi


@router.patch("/{kpi_id}", response_model=Kpi)
async def update_kpi(
    kpi_id: uuid.UUID,
    payload: KpiUpdate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> KpiModel:
    kpi = await db.get(KpiModel, kpi_id)
    if kpi is None or kpi.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")

    changes = payload.model_dump(exclude_unset=True)
    if SENSITIVE_FIELDS & changes.keys():
        result = await db.execute(
            text("select app.has_permission_on_employee(:caller, :target, 'kpi', 'update_target')"),
            {"caller": current.employee_id, "target": str(kpi.employee_id)},
        )
        if not result.scalar_one():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Changing target/weight/direction requires kpi/update_target on this employee",
            )

    for field, value in changes.items():
        setattr(kpi, field, value)

    await db.flush()
    await db.refresh(kpi)
    return kpi


@router.delete("/{kpi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_kpi(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    kpi = await db.get(KpiModel, kpi_id)
    if kpi is None or kpi.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")

    kpi.deleted_at = datetime.now(timezone.utc)
    await db.flush()


@router.get("/{kpi_id}/value-history", response_model=list[KpiValueHistoryEntry])
async def get_kpi_value_history(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiValueHistoryModel]:
    result = await db.execute(
        select(KpiValueHistoryModel).where(KpiValueHistoryModel.kpi_id == kpi_id).order_by(KpiValueHistoryModel.changed_at)
    )
    return list(result.scalars().all())


@router.get("/{kpi_id}/change-log", response_model=list[KpiChangeLogEntry])
async def get_kpi_change_log(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiChangeLogModel]:
    result = await db.execute(
        select(KpiChangeLogModel).where(KpiChangeLogModel.kpi_id == kpi_id).order_by(KpiChangeLogModel.changed_at)
    )
    return list(result.scalars().all())
