import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import PositionScore as PositionScoreModel
from app.models.goal import KpiScore as KpiScoreModel
from app.schemas.completion import PositionScore, RollupComputeRequest
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


@router.post("/compute-rollup", status_code=status.HTTP_204_NO_CONTENT)
async def compute_rollup(
    payload: RollupComputeRequest,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """Recomputes and snapshots every position in the company at once --
    app.compute_and_snapshot_position_score() (033_position_score_rollup.sql)
    walks the whole tree bottom-up in one call because a manager's score
    depends on their reports' scores, so computing "just one position"
    in isolation isn't meaningful; a single POST here refreshes the whole
    org's position_scores for the period. Same SECURITY DEFINER +
    internal-authorization-check shape as compute_and_snapshot_score above
    (reuses dashboard.view_executive rather than a bare permission check
    here, since it authorizes internally).
    """
    await db.execute(
        text("select app.compute_and_snapshot_position_score(:company_id, :period_start, :period_end)"),
        {
            "company_id": str(payload.company_id),
            "period_start": payload.period_start,
            "period_end": payload.period_end,
        },
    )
    await db.flush()


@router.get("/position-scores", response_model=list[PositionScore])
async def list_position_scores(
    position_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[PositionScoreModel]:
    stmt = select(PositionScoreModel).order_by(PositionScoreModel.computed_at.desc())
    if position_id is not None:
        stmt = stmt.where(PositionScoreModel.position_id == position_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())
