import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.goal import KpiScore as KpiScoreModel
from app.schemas.goal import KpiScore, ScoreComputeRequest

router = APIRouter(prefix="/scores", tags=["scores"])


@router.get("", response_model=list[KpiScore])
async def list_scores(
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiScoreModel]:
    stmt = select(KpiScoreModel).order_by(KpiScoreModel.computed_at.desc())
    if employee_id is not None:
        stmt = stmt.where(KpiScoreModel.employee_id == employee_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("/compute", response_model=KpiScore, status_code=201)
async def compute_score(
    payload: ScoreComputeRequest,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiScoreModel:
    """kpi_scores has no client INSERT policy at all -- the only write path
    is app.compute_and_snapshot_score() (022_compute_and_snapshot_score.sql),
    a SECURITY DEFINER function that does its own authorization check
    internally (mirrors kpis_update's self/update_value/update_target
    OR-chain) and bypasses RLS to insert the snapshot. A raw "not
    authorized" exception from that check is translated to a 403 by
    core/error_handlers.py.
    """
    result = await db.execute(
        text("select app.compute_and_snapshot_score(:employee_id, :period_start, :period_end)"),
        {
            "employee_id": str(payload.employee_id),
            "period_start": payload.period_start,
            "period_end": payload.period_end,
        },
    )
    score_id = result.scalar_one()
    await db.flush()
    score = await db.get(KpiScoreModel, score_id)
    return score
