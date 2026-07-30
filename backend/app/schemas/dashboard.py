from pydantic import BaseModel


class StatusCounts(BaseModel):
    counts: dict[str, int]
    total: int


class Dashboard(BaseModel):
    """Shared shape for executive/department/team dashboards -- all three
    are the same rollup at a different scope, so one schema covers them.
    """

    scope_type: str
    scope_id: str
    headcount: StatusCounts
    projects: StatusCounts
    tasks: StatusCounts
    goals: StatusCounts
    average_score: float | None = None
    scored_employee_count: int
