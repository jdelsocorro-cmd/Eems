import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.schemas.dashboard import Dashboard, ScoreTrendPoint, StatusCounts

router = APIRouter(prefix="/dashboards", tags=["dashboards"])

# Every query below runs on the normal RLS-scoped eems_app connection, same
# as every other read in this codebase -- no bypass, no extra bypass
# function needed. A dashboard is just an aggregate over tables that are
# already correctly scoped by their own RLS policies (employees_select,
# projects_select, tasks_select, goals_select); whatever the caller can't
# individually see, they also can't see summed up here. The scope filtering
# below narrows WHICH rows the aggregate considers; RLS still governs
# whether the caller is allowed to see each of those rows at all.
#
# "org_unit" scope rolls up the whole subtree via org_unit_closure (024),
# not just direct matches -- a unit with nested units under it (e.g. a
# Division containing Departments containing Teams) should show everything
# nested under it on its dashboard, the same way position_subtree scope
# already works for RBAC grants.
EMPLOYEE_SCOPE_JOIN = {
    "company": """
        join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
        join positions p on p.id = pa.position_id
        join org_units ou on ou.id = p.org_unit_id
        where ou.company_id = :scope_id
    """,
    "org_unit": """
        join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
        join positions p on p.id = pa.position_id
        join org_unit_closure ouc on ouc.descendant_unit_id = p.org_unit_id
        where ouc.ancestor_unit_id = :scope_id
    """,
}


async def _build_dashboard(db: AsyncSession, scope_type: Literal["company", "org_unit"], scope_id: uuid.UUID) -> Dashboard:
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

    if scope_type == "company":
        projects_result = await db.execute(
            text("select status, count(*) as n from projects where company_id = :scope_id and deleted_at is null group by status"),
            {"scope_id": str(scope_id)},
        )
    else:
        projects_result = await db.execute(
            text("""
                select status, count(*) as n from projects
                where org_unit_id in (select descendant_unit_id from org_unit_closure where ancestor_unit_id = :scope_id)
                  and deleted_at is null
                group by status
            """),
            {"scope_id": str(scope_id)},
        )
    projects = {row.status: row.n for row in projects_result.all()}

    # project_ids_in_scope() (023, updated in 025) bypasses projects' own
    # RLS for this lookup so scope resolution doesn't accidentally require
    # projects_select visibility (a different permission axis from
    # tasks_select's own assignee-subtree visibility, which is what should
    # actually gate which tasks show up here) -- see 023 for the bug this fixed.
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

    if scope_type == "company":
        goals_result = await db.execute(
            text("select status, count(*) as n from goals where company_id = :scope_id and deleted_at is null group by status"),
            {"scope_id": str(scope_id)},
        )
    else:
        goals_result = await db.execute(
            text("""
                select status, count(*) as n from goals
                where org_unit_id in (select descendant_unit_id from org_unit_closure where ancestor_unit_id = :scope_id)
                  and deleted_at is null
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

    # Real historical trend, not a fabricated one -- collapses each scoped
    # employee's LATEST snapshot per period (a period can be recomputed more
    # than once), then averages across employees per period, same shape as
    # the single-latest-overall query above just grouped by period instead
    # of collapsed to "now". Capped at 8 points and returned oldest-first,
    # the natural reading direction for a sparkline.
    trend_result = await db.execute(
        text(f"""
            with scoped_employees as (
                select distinct e.id
                from employees e
                {EMPLOYEE_SCOPE_JOIN[scope_type]}
                and e.deleted_at is null
            ),
            latest_per_period as (
                select distinct on (ks.employee_id, ks.period_start) ks.period_start, ks.computed_score
                from kpi_scores ks
                join scoped_employees se on se.id = ks.employee_id
                order by ks.employee_id, ks.period_start, ks.computed_at desc
            )
            select period_start, avg(computed_score) as avg_score
            from latest_per_period
            where computed_score is not null
            group by period_start
            order by period_start desc
            limit 8
        """),
        {"scope_id": str(scope_id)},
    )
    score_trend = [
        ScoreTrendPoint(period_start=row.period_start, average_score=round(float(row.avg_score), 2))
        for row in reversed(trend_result.all())
    ]

    # Adoption metric for the scoring pipeline: of everyone in scope, how
    # many have at least one active KPI actually backed by linked evidence
    # (a task/project/milestone via kpi_tasks/kpi_projects/kpi_milestones,
    # 031_kpi_links.sql) rather than a KPI that just sits there unlinked --
    # the exact gap diagnosed this session (employees with real completed
    # work but zero KPIs, so nothing rolls up to their scorecard).
    evidence_result = await db.execute(
        text(f"""
            with scoped_employees as (
                select distinct e.id
                from employees e
                {EMPLOYEE_SCOPE_JOIN[scope_type]}
                and e.deleted_at is null
            )
            select
                (select count(*) from scoped_employees) as total_employees,
                (
                    select count(distinct k.employee_id)
                    from kpis k
                    join scoped_employees se on se.id = k.employee_id
                    where k.deleted_at is null and k.status = 'active'
                      and (
                        exists (select 1 from kpi_tasks kt where kt.kpi_id = k.id)
                        or exists (select 1 from kpi_projects kp where kp.kpi_id = k.id)
                        or exists (select 1 from kpi_milestones km where km.kpi_id = k.id)
                      )
                ) as employees_with_evidence
        """),
        {"scope_id": str(scope_id)},
    )
    evidence_row = evidence_result.one()
    kpi_evidence_coverage_pct = (
        round(evidence_row.employees_with_evidence / evidence_row.total_employees * 100, 1)
        if evidence_row.total_employees > 0
        else None
    )

    return Dashboard(
        scope_type=scope_type,
        scope_id=str(scope_id),
        headcount=StatusCounts(counts=headcount, total=sum(headcount.values())),
        projects=StatusCounts(counts=projects, total=sum(projects.values())),
        tasks=StatusCounts(counts=tasks, total=sum(tasks.values())),
        goals=StatusCounts(counts=goals, total=sum(goals.values())),
        average_score=round(float(score_row.avg_score), 2) if score_row.avg_score is not None else None,
        scored_employee_count=score_row.scored_count,
        score_trend=score_trend,
        kpi_evidence_coverage_pct=kpi_evidence_coverage_pct,
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


@router.get("/org-unit/{org_unit_id}", response_model=Dashboard)
async def get_org_unit_dashboard(
    org_unit_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> Dashboard:
    """No permission gate beyond authentication -- unlike the company-wide
    executive view, this is scoped to a single unit (and its subtree) that
    the underlying per-row RLS on employees/projects/tasks/goals already
    handles: a caller with no visibility into this unit's people or work
    just gets an all-zero dashboard, not an error. Rolls up the whole
    subtree under org_unit_id via org_unit_closure, so a Division-level
    dashboard includes everything nested under it, not just direct children.
    """
    return await _build_dashboard(db, "org_unit", org_unit_id)
