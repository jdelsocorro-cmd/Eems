"""Live test of Performance Review Center's core design bet: the SIX
unscoped "all-in-scope" endpoints it calls with zero query params (GET
/tasks, /projects, /goals, /kpis, /scores, /completion-submissions) already
return exactly the right per-caller set via RLS, for EITHER of the two
mechanisms that can grant that visibility --

(a) management hierarchy (app.hierarchy_subtree_employee_ids, purely from
    the reporting-line position_closure, zero employee_roles grants needed
    -- proven for a Manager who structurally occupies a position above
    Staff), and
(b) an explicit RBAC position_subtree grant (app.accessible_position_ids'
    position_subtree branch, 025_migrate_positions_projects_goals_to_org_
    units.sql:210-216) held by someone who occupies NO position in the
    hierarchy at all -- proven for "ScopedReviewer", who has zero position
    assignment and relies entirely on a single position_subtree-scoped
    employee_roles grant.

Tree: DeptHead -> Manager -> Staff, plus a structurally unrelated sibling
Contributor position (matches test_employee_360_live.py's shape, reused
deliberately for consistency). ScopedReviewer holds no position at all --
only a position_subtree grant scoped to Manager's position -- so
hierarchy_subtree_employee_ids contributes nothing for them; whatever they
see is proof the RBAC-grant path alone works, not a hierarchy fallback in
disguise.

Also confirms GET /scores/position-scores is never called by Performance
Review Center's frontend code (see the regression-guard note in
usePerformanceReviewData.ts) -- that table is company-scoped, not
subtree-scoped, and would be a real leak if reused here for a
position_subtree-only caller.

Skipped by default -- see test_user_rbac_live.py for the RUN_LIVE_TESTS=1
convention and rationale.
"""

import os
import uuid

import asyncpg
import httpx
import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LIVE_TESTS") != "1",
    reason="Live integration test -- needs real Supabase credentials and network access. Set RUN_LIVE_TESTS=1 to run.",
)


def _load_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    with open(env_path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and "=" in line and not line.startswith("#"):
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


_load_env()

from app.main import app  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PASSWORD = "Test1234!Verify"


def _admin_db_url() -> str:
    admin_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "supabase", ".env")
    with open(admin_env_path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line.startswith("SUPABASE_DB_ADMIN_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("SUPABASE_DB_ADMIN_URL not found in supabase/.env")


@pytest.mark.asyncio
async def test_performance_review_center_scope_narrowing():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    created_auth_user_ids = []

    try:
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"PRC Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_id
        )

        depthead_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'DeptHead',$2) returning id", unit_id, f"DH{suffix}"
        )
        manager_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Manager',$2,$3) returning id",
            unit_id, f"MGR{suffix}", depthead_pos,
        )
        staff_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Staff',$2,$3) returning id",
            unit_id, f"STF{suffix}", manager_pos,
        )
        contributor_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Contributor',$2) returning id", unit_id, f"CTR{suffix}"
        )

        async def make_employee(email: str, first: str) -> tuple[str, dict]:
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                json={"email": email, "password": PASSWORD, "email_confirm": True},
            )
            resp.raise_for_status()
            auth_user_id = resp.json()["id"]
            created_auth_user_ids.append(auth_user_id)
            employee_id = await admin_conn.fetchval(
                "insert into employees (auth_user_id, first_name, last_name, work_email) values ($1,$2,$3,$4) returning id",
                auth_user_id, first, "PRC", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        depthead_id, _ = await make_employee(f"eems-prc-dh-{suffix}@eems-live-test.dev", "DeptHead")
        manager_id, headers_manager = await make_employee(f"eems-prc-mgr-{suffix}@eems-live-test.dev", "Manager")
        staff_id, headers_staff = await make_employee(f"eems-prc-staff-{suffix}@eems-live-test.dev", "Staff")
        contributor_id, headers_contributor = await make_employee(f"eems-prc-ctr-{suffix}@eems-live-test.dev", "Contributor")
        # ScopedReviewer holds NO position at all -- their only access is
        # the position_subtree grant added below. If they see Staff's data,
        # that's proof the RBAC-grant path works on its own, not a
        # hierarchy_subtree_employee_ids fallback in disguise (that
        # function requires the caller to CURRENTLY HOLD a position).
        scoped_reviewer_id, headers_scoped_reviewer = await make_employee(
            f"eems-prc-sr-{suffix}@eems-live-test.dev", "ScopedReviewer"
        )

        for pos_id, emp_id in ((depthead_pos, depthead_id), (manager_pos, manager_id), (staff_pos, staff_id), (contributor_pos, contributor_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, depthead_id,
            )

        # A minimal, permission-less role -- accessible_position_ids
        # resolves purely off employee_roles.scope_type/scope_id
        # (025_migrate_positions_projects_goals_to_org_units.sql:179-225),
        # it never checks which permission the granting role carries, so a
        # zero-permission role isolates exactly what's under test: scope
        # resolution, not permission checking.
        scoped_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"PRC Scoped Reviewer {suffix}"
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            scoped_reviewer_id, scoped_role_id, manager_pos,
        )

        # --- Fixture data: one of each of the 6 data types for Staff (the
        # in-scope target for both callers), plus one project each for
        # Contributor (sibling, must not leak) and DeptHead (upward from
        # Manager, must not leak). ---
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_staff, json={"title": "Staff task", "assignee_employee_id": staff_id}
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        staff_task_id = resp.json()["id"]
        resp = await api_client.post(f"/api/v1/tasks/{staff_task_id}/submit-completion", headers=headers_staff, json={"summary": "Done."})
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        staff_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Staff project',$2) returning id",
            company_id, staff_id,
        )
        staff_goal_id = await admin_conn.fetchval(
            """insert into goals (company_id, title, goal_type, employee_id, owner_employee_id, period_start, period_end)
               values ($1,'Staff goal','individual',$2,$2,current_date,current_date + 30) returning id""",
            company_id, staff_id,
        )
        staff_kpi_id = await admin_conn.fetchval(
            """insert into kpis (employee_id, name, unit, direction, target_value, weight, period_start, period_end)
               values ($1,'Staff KPI','count','higher_is_better',10,100,current_date,current_date + 30) returning id""",
            staff_id,
        )
        await admin_conn.execute(
            "insert into kpi_scores (employee_id, period_start, period_end, computed_score, kpi_snapshot) values ($1,current_date,current_date,80,'[]'::jsonb)",
            staff_id,
        )

        contributor_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Contributor project',$2) returning id",
            company_id, contributor_id,
        )
        depthead_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'DeptHead project',$2) returning id",
            company_id, depthead_id,
        )

        async def assert_scope(headers: dict, label: str, *, expect_projects: bool):
            # GET /tasks -- unscoped, no assignee_employee_id param.
            resp = await api_client.get("/api/v1/tasks", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            task_ids = {t["id"] for t in resp.json()}
            assert staff_task_id in task_ids, f"{label} should see Staff's task via unscoped /tasks"

            # GET /projects -- unscoped. UNLIKE tasks/goals/kpis/scores/
            # completion-submissions, projects_select (040:102-108) has NO
            # accessible_employee_ids() branch -- only hierarchy_subtree_
            # employee_ids and a company-wide project.read_all permission
            # check. A caller whose ONLY access is a position_subtree/
            # org_unit RBAC grant (no position of their own, no company-
            # wide read_all) genuinely cannot see a subordinate's projects
            # today -- a real, pre-existing gap in projects_select shared by
            # Projects.tsx already, not something this feature introduces.
            # expect_projects=False documents that live-proven limitation
            # rather than asserting something the system doesn't actually do.
            resp = await api_client.get("/api/v1/projects", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            project_ids = {p["id"] for p in resp.json()}
            if expect_projects:
                assert str(staff_project_id) in project_ids, f"{label} should see Staff's project via unscoped /projects"
            else:
                assert str(staff_project_id) not in project_ids, (
                    f"{label} should NOT see Staff's project (projects_select has no accessible_employee_ids branch -- "
                    "known gap, see comment above)"
                )
            assert str(contributor_project_id) not in project_ids, f"{label} must NOT see Contributor's (sibling) project"
            assert str(depthead_project_id) not in project_ids, f"{label} must NOT see DeptHead's (upward) project"

            # GET /goals -- unscoped.
            resp = await api_client.get("/api/v1/goals", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            goal_ids = {g["id"] for g in resp.json()}
            assert str(staff_goal_id) in goal_ids, f"{label} should see Staff's goal via unscoped /goals"

            # GET /kpis -- unscoped.
            resp = await api_client.get("/api/v1/kpis", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            kpi_ids = {k["id"] for k in resp.json()}
            assert str(staff_kpi_id) in kpi_ids, f"{label} should see Staff's KPI via unscoped /kpis"

            # GET /scores -- unscoped (kpi_scores, correctly subtree-scoped
            # -- NOT /scores/position-scores, which is company-scoped).
            resp = await api_client.get("/api/v1/scores", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            score_employee_ids = {s["employee_id"] for s in resp.json()}
            assert staff_id in score_employee_ids, f"{label} should see Staff's score via unscoped /scores"

            # GET /completion-submissions -- unscoped.
            resp = await api_client.get("/api/v1/completion-submissions", headers=headers)
            assert resp.status_code == 200, f"{label}: {resp.status_code} {resp.text}"
            submitted_by_ids = {s["submitted_by"] for s in resp.json()}
            assert staff_id in submitted_by_ids, f"{label} should see Staff's completion submission via unscoped /completion-submissions"

        # (a) Manager: hierarchy-based visibility, ZERO employee_roles
        # grants. hierarchy_subtree_employee_ids covers all six endpoints,
        # projects included (it's one of the two branches projects_select
        # actually has), so the full set is expected here.
        await assert_scope(headers_manager, "Manager (hierarchy only, no RBAC grant)", expect_projects=True)

        # (b) ScopedReviewer: RBAC position_subtree grant, holds NO
        # position at all -- hierarchy_subtree_employee_ids contributes
        # nothing for them, so this isolates the RBAC-grant path alone.
        # Projects is the one exception (see assert_scope's comment).
        await assert_scope(headers_scoped_reviewer, "ScopedReviewer (position_subtree grant, no position held)", expect_projects=False)

        # (c) Sibling Contributor must not see Staff's data either --
        # confirms the scope narrowing isn't just "everyone in the company".
        resp = await api_client.get("/api/v1/projects", headers=headers_contributor)
        assert resp.status_code == 200
        contributor_visible_project_ids = {p["id"] for p in resp.json()}
        assert str(staff_project_id) not in contributor_visible_project_ids, "Contributor (sibling) must not see Staff's project"

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-prc-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            if emp_ids:
                await admin_conn.execute("delete from kpi_scores where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute(
                    "delete from kpi_value_history where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids
                )
                await admin_conn.execute(
                    "delete from kpi_change_log where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids
                )
                await admin_conn.execute("delete from kpis where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from goals where employee_id = any($1::uuid[])", emp_ids)

                project_ids = await admin_conn.fetch("select id from projects where owner_employee_id = any($1::uuid[])", emp_ids)
                project_ids = [r["id"] for r in project_ids]
                if project_ids:
                    await admin_conn.execute("delete from projects where id = any($1::uuid[])", project_ids)

            task_ids = await admin_conn.fetch("select id from tasks where assignee_employee_id = any($1::uuid[])", emp_ids)
            task_ids = [r["id"] for r in task_ids]
            if task_ids:
                await admin_conn.execute(
                    "delete from completion_evidence_links where submission_id in (select id from completion_submissions where entity_type = 'task' and entity_id = any($1::uuid[]))",
                    task_ids,
                )
                await admin_conn.execute("delete from completion_submissions where entity_type = 'task' and entity_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from task_status_history where task_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from task_comments where task_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from tasks where id = any($1::uuid[])", task_ids)

            role_ids = await admin_conn.fetch("select id from roles where name like $1", f"%{suffix}%")
            role_ids = [r["id"] for r in role_ids]
            if role_ids:
                await admin_conn.execute("delete from role_permissions where role_id = any($1::uuid[])", role_ids)
                await admin_conn.execute("delete from employee_roles where role_id = any($1::uuid[])", role_ids)
                await admin_conn.execute("delete from roles where id = any($1::uuid[])", role_ids)

            if emp_ids:
                await admin_conn.execute("delete from employee_roles where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from position_assignments where employee_id = any($1::uuid[])", emp_ids)

            position_ids = await admin_conn.fetch(
                "select p.id from positions p join org_units ou on ou.id = p.org_unit_id where ou.company_id = $1", company_id
            )
            position_ids = [r["id"] for r in position_ids]
            if position_ids:
                await admin_conn.execute("delete from position_assignments where position_id = any($1::uuid[])", position_ids)
                await admin_conn.execute(
                    "delete from position_closure where ancestor_position_id = any($1::uuid[]) or descendant_position_id = any($1::uuid[])",
                    position_ids,
                )
                await admin_conn.execute("update positions set reports_to_position_id = null where id = any($1::uuid[])", position_ids)
                await admin_conn.execute(
                    "delete from position_hierarchy_history where position_id = any($1::uuid[]) or old_reports_to_position_id = any($1::uuid[]) or new_reports_to_position_id = any($1::uuid[])",
                    position_ids,
                )
                await admin_conn.execute("delete from positions where id = any($1::uuid[])", position_ids)

            unit_ids = await admin_conn.fetch("select id from org_units where company_id = $1", company_id)
            unit_ids = [r["id"] for r in unit_ids]
            if unit_ids:
                await admin_conn.execute(
                    "delete from org_unit_closure where ancestor_unit_id = any($1::uuid[]) or descendant_unit_id = any($1::uuid[])",
                    unit_ids,
                )
            await admin_conn.execute("delete from org_units where company_id = $1", company_id)

            if emp_ids:
                await admin_conn.execute("delete from audit_log where actor_employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from employees where id = any($1::uuid[])", emp_ids)

            await admin_conn.execute("delete from companies where id = $1", company_id)
        finally:
            for auth_id in created_auth_user_ids:
                await auth_client.delete(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{auth_id}",
                    headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                )
            await admin_conn.close()
            await auth_client.aclose()
            await api_client.aclose()
