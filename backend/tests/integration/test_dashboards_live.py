"""Live test of task 10 (executive/org-unit dashboards) against the real
Supabase database: aggregate counts for headcount/projects/tasks/goals at
each scope, average-score computation from the latest kpi_scores snapshot
per employee, that dashboards are naturally RLS-scoped (an outsider with no
visibility into the company sees an all-zero dashboard rather than an error
or someone else's data) plus the one gated case (executive dashboard
requires dashboard/view_executive), and that an org-unit dashboard rolls up
its whole subtree (a Department-level dashboard includes a nested Team's
data, not just direct children) via org_unit_closure.

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
async def test_dashboards_flow():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    admin_email = f"eems-t10-admin-{suffix}@eems-live-test.dev"
    manager_email = f"eems-t10-mgr-{suffix}@eems-live-test.dev"
    outsider_email = f"eems-t10-outsider-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T10 Co {suffix}")
        outsider_company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T10 Outsider Co {suffix}")

        dept_unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Eng','department') returning id", company_id
        )
        team_unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type, parent_unit_id) values ($1,'Backend','team',$2) returning id",
            company_id, dept_unit_id,
        )
        mgr_pos_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Manager',$2) returning id", team_unit_id, f"MGR{suffix}"
        )
        staff_pos_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Engineer',$2,$3) returning id",
            team_unit_id, f"ENG{suffix}", mgr_pos_id,
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
                auth_user_id, first, "T10", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_id, headers_admin = await make_employee(admin_email, "Admin")
        manager_id, headers_manager = await make_employee(manager_email, "Manager")
        outsider_id, headers_outsider = await make_employee(outsider_email, "Outsider")

        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
            mgr_pos_id, manager_id, admin_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_id, super_admin_role_id, company_id,
        )
        # A manager only sees their own record by default -- visibility into
        # subordinates requires an explicit scoped grant (that's the whole
        # point of RBAC scope, not something self-visibility gives for
        # free). Grant them position_subtree scope on their own position so
        # the team dashboard test below actually exercises manager-level
        # visibility, not just self.
        manager_role_id = "00000000-0000-0000-0001-000000000004"
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            manager_id, manager_role_id, mgr_pos_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            outsider_id, super_admin_role_id, outsider_company_id,
        )

        # a second engineer, hired under the manager, to make headcount/task counts non-trivial
        staff_id = await admin_conn.fetchval(
            "insert into employees (first_name, last_name, work_email, created_by) values ($1,$2,$3,$4) returning id",
            "Staff", "T10", f"eems-t10-staff-{suffix}@eems-live-test.dev", admin_id,
        )
        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
            staff_pos_id, staff_id, admin_id,
        )

        # projects + tasks in various statuses
        resp = await api_client.post(
            "/api/v1/projects", headers=headers_admin,
            json={"company_id": str(company_id), "org_unit_id": str(team_unit_id), "name": "P1", "status": "active"},
        )
        assert resp.status_code == 201, resp.text
        project_id = resp.json()["id"]
        resp = await api_client.patch(f"/api/v1/projects/{project_id}", headers=headers_admin, json={"status": "active"})
        assert resp.status_code == 200

        resp = await api_client.post(
            "/api/v1/projects", headers=headers_admin,
            json={"company_id": str(company_id), "name": "P2", "status": "planning"},
        )
        assert resp.status_code == 201, resp.text

        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_admin,
            json={"project_id": project_id, "title": "Task 1", "assignee_employee_id": str(staff_id)},
        )
        assert resp.status_code == 201, resp.text
        task_id = resp.json()["id"]
        resp = await api_client.patch(f"/api/v1/tasks/{task_id}", headers=headers_admin, json={"status": "done"})
        assert resp.status_code == 200

        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_admin,
            json={"project_id": project_id, "title": "Task 2", "assignee_employee_id": str(staff_id)},
        )
        assert resp.status_code == 201, resp.text

        # a goal + a scored KPI for staff, so average_score is non-null
        resp = await api_client.post(
            "/api/v1/goals", headers=headers_admin,
            json={
                "company_id": str(company_id), "title": "G1", "goal_type": "individual", "employee_id": str(staff_id),
                "period_start": "2026-01-01", "period_end": "2026-12-31",
            },
        )
        assert resp.status_code == 201, resp.text
        goal_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/kpis", headers=headers_admin,
            json={
                "employee_id": str(staff_id), "goal_id": goal_id, "name": "Output", "unit": "count",
                "direction": "higher_is_better", "target_value": 10, "weight": 100,
                "period_start": "2026-01-01", "period_end": "2026-12-31",
            },
        )
        assert resp.status_code == 201, resp.text
        kpi_id = resp.json()["id"]
        resp = await api_client.patch(f"/api/v1/kpis/{kpi_id}", headers=headers_admin, json={"current_value": 5})
        assert resp.status_code == 200

        resp = await api_client.post(
            "/api/v1/scores/compute", headers=headers_admin,
            json={"employee_id": str(staff_id), "period_start": "2026-01-01", "period_end": "2026-12-31"},
        )
        assert resp.status_code == 201, resp.text

        # --- executive dashboard: gated by dashboard/view_executive ---
        resp = await api_client.get(f"/api/v1/dashboards/executive/{company_id}", headers=headers_admin)
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        dash = resp.json()
        assert dash["headcount"]["total"] == 2, f"expected 2 (manager + staff), got {dash['headcount']}"
        assert dash["projects"]["counts"].get("active") == 1
        assert dash["projects"]["counts"].get("planning") == 1
        assert dash["tasks"]["counts"].get("done") == 1
        assert dash["tasks"]["counts"].get("todo") == 1
        assert dash["goals"]["total"] == 1
        assert dash["average_score"] == 50.0, f"expected 5/10*100=50.0, got {dash['average_score']}"
        assert dash["scored_employee_count"] == 1

        # outsider lacks dashboard/view_executive entirely -- 403, not an empty dashboard
        resp = await api_client.get(f"/api/v1/dashboards/executive/{company_id}", headers=headers_outsider)
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # --- department-level org-unit dashboard: no permission gate, RLS naturally scopes it.
        # Rolls up the subtree via org_unit_closure -- P1 is attached to the
        # nested Backend TEAM unit, not the Department unit directly, and
        # should still show up here.
        resp = await api_client.get(f"/api/v1/dashboards/org-unit/{dept_unit_id}", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        dept_dash = resp.json()
        assert dept_dash["headcount"]["total"] == 2
        assert dept_dash["projects"]["counts"].get("active") == 1, "should roll up the nested team's project"

        # outsider CAN load the org-unit dashboard (no permission gate) but sees nothing real --
        # RLS filters every underlying table to zero visible rows for them
        resp = await api_client.get(f"/api/v1/dashboards/org-unit/{dept_unit_id}", headers=headers_outsider)
        assert resp.status_code == 200, resp.text
        outsider_dept_dash = resp.json()
        assert outsider_dept_dash["headcount"]["total"] == 0
        assert outsider_dept_dash["projects"]["total"] == 0
        assert outsider_dept_dash["average_score"] is None

        # --- team-level org-unit dashboard: manager (holds no dashboard permission, but has subtree visibility via their own position) ---
        resp = await api_client.get(f"/api/v1/dashboards/org-unit/{team_unit_id}", headers=headers_manager)
        assert resp.status_code == 200, resp.text
        team_dash = resp.json()
        assert team_dash["headcount"]["total"] == 2, "manager should see themself + their direct report via accessible_employee_ids"
        assert team_dash["tasks"]["counts"].get("done") == 1

    finally:
        try:
            company_ids = [company_id, outsider_company_id]
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-t10-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            if emp_ids:
                await admin_conn.execute("delete from kpi_scores where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from kpi_change_log where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpi_value_history where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpis where employee_id = any($1::uuid[])", emp_ids)

            await admin_conn.execute("delete from goals where company_id = any($1::uuid[])", company_ids)

            await admin_conn.execute("delete from task_status_history where task_id in (select id from tasks where project_id in (select id from projects where company_id = any($1::uuid[])))", company_ids)
            await admin_conn.execute("delete from tasks where project_id in (select id from projects where company_id = any($1::uuid[]))", company_ids)
            await admin_conn.execute("delete from project_members where project_id in (select id from projects where company_id = any($1::uuid[]))", company_ids)
            await admin_conn.execute("delete from projects where company_id = any($1::uuid[])", company_ids)

            position_ids = await admin_conn.fetch(
                "select p.id from positions p join org_units ou on ou.id = p.org_unit_id where ou.company_id = any($1::uuid[])",
                company_ids,
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

            unit_ids = await admin_conn.fetch("select id from org_units where company_id = any($1::uuid[])", company_ids)
            unit_ids = [r["id"] for r in unit_ids]
            if unit_ids:
                await admin_conn.execute(
                    "delete from org_unit_closure where ancestor_unit_id = any($1::uuid[]) or descendant_unit_id = any($1::uuid[])",
                    unit_ids,
                )
                await admin_conn.execute("update org_units set parent_unit_id = null where id = any($1::uuid[])", unit_ids)
                await admin_conn.execute(
                    "delete from org_unit_hierarchy_history where org_unit_id = any($1::uuid[]) or old_parent_unit_id = any($1::uuid[]) or new_parent_unit_id = any($1::uuid[])",
                    unit_ids,
                )
                await admin_conn.execute("delete from org_units where id = any($1::uuid[])", unit_ids)

            if emp_ids:
                await admin_conn.execute("delete from employee_roles where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from position_assignments where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from audit_log where actor_employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("update employees set created_by = null where created_by = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from employees where id = any($1::uuid[])", emp_ids)

            await admin_conn.execute("delete from companies where id = any($1::uuid[])", company_ids)
        finally:
            for auth_id in created_auth_user_ids:
                await auth_client.delete(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{auth_id}",
                    headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                )
            await admin_conn.close()
            await auth_client.aclose()
            await api_client.aclose()
