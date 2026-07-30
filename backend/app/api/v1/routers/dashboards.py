import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.schemas.dashboard import Dashboard, StatusCounts

router = APIRouter(prefix="/dashboards", tags=["dashboards"])

# Every query below runs on the normal RLS-scoped eems_app connection, same
# as every other read in this codebase -- no bypass, no extra bypass
# function needed. That's deliberate: a dashboard is just an aggregate over
# tables that are already correctly scoped by their own RLS policies
# (employees_select, projects_select, tasks_select, goals_select), so
# whatever the caller can't individually see, they also can't see summed up
# here. Company-scope filtering below (via the department/team/company join
# chain) narrows WHICH rows the aggregate considers; RLS still governs
# whether the caller is allowed to see each of those rows at all.
EMPLOYEE_SCOPE_JOIN = {
    "company": """
        join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
        join positions p on p.id = pa.position_id
        join teams t on t.id = p.team_id
        join departments d on d.id = t.department_id
        where d.company_id = :scope_id
    """,
    "department": """
        join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
        join positions p on p.id = pa.position_id
        join teams t on t.id = p.team_id
        where t.department_id = :scope_id
    """,
    "team": """
        join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
        join positions p on p.id = pa.position_id
        where p.team_id = :scope_id
    """,
}

PROJECT_SCOPE_COLUMN = {"company": "company_id", "department": "department_id", "team": "team_id"}
GOAL_SCOPE_COLUMN = {"company": "company_id", "department": "department_id", "team": "team_id"}


async def _build_dashboard(db: AsyncSession, scope_type: Literal["company", "department", "team"], scope_id: uuid.UUID) -> Dashboard:
    headcount_result = await db.execute(
        text(f"""
            select e.status, count(*) as n
            from employees e
            {EMPLOYEE_SCOPE_JOIN[scope_type]}
            and e.deleted_at is null
            group by e.status
        """),
        {"scope_id": str(scope_id)},
    )
    headcount = {row.status: row.n for row in headcount_result.all()}

    project_column = PROJECT_SCOPE_COLUMN[scope_type]
    projects_result = await db.execute(
        text(f"""
            select status, count(*) as n from projects
            where {project_column} = :scope_id and deleted_at is null
            group by status
        """),
        {"scope_id": str(scope_id)},
    )
    projects = {row.status: row.n for row in projects_result.all()}

    # project_ids_in_scope() (023) bypasses projects' own RLS for this
    # lookup so scope resolution doesn't accidentally require projects_select
    # visibility (a different permission axis from tasks_select's own
    # assignee-subtree visibility, which is what should actually gate which
    # tasks show up here) -- see that migration for the bug this fixed.
    tasks_result = await db.execute(
        text("""
            select status, count(*) as n
            from tasks
            where project_id in (select app.project_ids_in_scope(:scope_type, :scope_id))
              and deleted_at is null
            group by status
        """),
        {"scope_type": scope_type, "scope_id": str(scope_id)},
    )
    tasks = {row.status: row.n for row in tasks_result.all()}

    goal_column = GOAL_SCOPE_COLUMN[scope_type]
    goals_result = await db.execute(
        text(f"""
            select status, count(*) as n from goals
            where {goal_column} = :scope_id and deleted_at is null
            group by status
        """),
        {"scope_id": str(scope_id)},
    )
    goals = {row.status: row.n for row in goals_result.all()}

    score_result = await db.execute(
        text(f"""
            with scoped_employees as (
                select distinct e.id
                from employees e
                {EMPLOYEE_SCOPE_JOIN[scope_type]}
                and e.deleted_at is null
            ),
            latest_scores as (
                select distinct on (ks.employee_id) ks.employee_id, ks.computed_score
                from kpi_scores ks
                join scoped_employees se on se.id = ks.employee_id
                order by ks.employee_id, ks.computed_at desc
            )
            select avg(computed_score) as avg_score, count(computed_score) as scored_count
            from latest_scores
        """),
        {"scope_id": str(scope_id)},
    )
    score_row = score_result.one()

    return Dashboard(
        scope_type=scope_type,
        scope_id=str(scope_id),
        headcount=StatusCounts(counts=headcount, total=sum(headcount.values())),
        projects=StatusCounts(counts=projects, total=sum(projects.values())),
        tasks=StatusCounts(counts=tasks, total=sum(tasks.values())),
        goals=StatusCounts(counts=goals, total=sum(goals.values())),
        average_score=round(float(score_row.avg_score), 2) if score_row.avg_score is not None else None,
        scored_employee_count=score_row.scored_count,
    )


@router.get("/executive/{company_id}", response_model=Dashboard)
async def get_executive_dashboard(
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> Dashboard:
    """Deliberately NOT Depends(require_permission(...)) -- that factory
    only checks app.has_permission() unscoped ("held anywhere"), which
    would let a dashboard/view_executive holder at Company B "successfully"
    request Company A's executive dashboard and just get zero-filled
    results back (RLS still filters the underlying rows correctly, so
    nothing actually leaks, but a 200-with-nothing is a confusing, wrong
    response for a request the caller has no relationship to at all -- same
    scope-blind-permission class as every other has_permission_on_company
    fix in this codebase). Checked inline since company_id here is a path
    param, not something the require_permission factory has access to.
    """
    result = await db.execute(
        text("select app.has_permission_on_company(:employee_id, :company_id, 'dashboard', 'view_executive')"),
        {"employee_id": current.employee_id, "company_id": str(company_id)},
    )
    if not result.scalar_one():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing permission: dashboard.view_executive for this company",
        )
    return await _build_dashboard(db, "company", company_id)


@router.get("/department/{department_id}", response_model=Dashboard)
async def get_department_dashboard(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> Dashboard:
    """No permission gate beyond authentication -- unlike the company-wide
    executive view, this is scoped low enough (a single department) that
    the underlying per-row RLS on employees/projects/tasks/goals is
    sufficient: a caller with no visibility into this department's people
    or work just gets an all-zero dashboard, not an error.
    """
    return await _build_dashboard(db, "department", department_id)


@router.get("/team/{team_id}", response_model=Dashboard)
async def get_team_dashboard(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> Dashboard:
    return await _build_dashboard(db, "team", team_id)
