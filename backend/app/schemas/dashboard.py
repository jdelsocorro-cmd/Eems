from datetime import date

from pydantic import BaseModel


class StatusCounts(BaseModel):
    counts: dict[str, int]
    total: int


class ScoreTrendPoint(BaseModel):
    period_start: date
    average_score: float


class Dashboard(BaseModel):
    """Shared shape for the executive (company) dashboard and any org-unit
    dashboard (which rolls up its whole subtree) -- both are the same
    rollup at a different scope, so one schema covers them.
    """

    scope_type: str
    scope_id: str
    headcount: StatusCounts
    projects: StatusCounts
    tasks: StatusCounts
    goals: StatusCounts
    average_score: float | None = None
    scored_employee_count: int
    # Up to the last 8 periods with a computed score in scope, oldest first
    # -- real historical snapshots from kpi_scores, not a fabricated trend.
    score_trend: list[ScoreTrendPoint] = []
    # % of employees in scope who have at least one active KPI backed by
    # real evidence (a linked task/project/milestone), out of total
    # headcount in scope. None when scope has zero employees. This is the
    # adoption metric for the scoring pipeline itself -- see the
    # Jhustyn/Rogel "why don't scores show up" gap this measures.
    kpi_evidence_coverage_pct: float | None = None
