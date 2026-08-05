"""Live test of Employee 360's hierarchy-derived visibility
(040_employee_360_hierarchy_visibility.sql): app.hierarchy_subtree_
employee_ids() should let a leader see a report's full profile -- tasks,
projects, goals, KPIs, scores, recognitions, completion submissions --
purely via the reporting-line hierarchy (position_closure), with ZERO
employee_roles grants, while still refusing to leak sideways (a sibling
outside the chain) or upward (a report seeing their own manager's data).

Tree: DeptHead -> Manager -> Staff, plus a structurally unrelated sibling
Contributor position, matching the shape test_hierarchy_review_escalation_
live.py already uses for the same reason.

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
async def test_employee_360_hierarchy_visibility():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    created_auth_user_ids = []

    try:
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"E360 Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_id
        )

        # DeptHead -> Manager -> Staff, plus a sibling Contributor position
        # structurally OUTSIDE that chain (own root, no reports_to).
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
                auth_user_id, first, "E360", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        depthead_id, headers_depthead = await make_employee(f"eems-e360-dh-{suffix}@eems-live-test.dev", "DeptHead")
        manager_id, headers_manager = await make_employee(f"eems-e360-mgr-{suffix}@eems-live-test.dev", "Manager")
        staff_id, headers_staff = await make_employee(f"eems-e360-staff-{suffix}@eems-live-test.dev", "Staff")
        contributor_id, headers_contributor = await make_employee(f"eems-e360-ctr-{suffix}@eems-live-test.dev", "Contributor")

        for pos_id, emp_id in ((depthead_pos, depthead_id), (manager_pos, manager_id), (staff_pos, staff_id), (contributor_pos, contributor_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, depthead_id,
            )

        # Zero employee_roles grants for anyone -- every visibility check
        # below must succeed (or fail) purely off the reporting-line
        # hierarchy, not RBAC.

        # --- Fixture data for Staff (task via API + submit-completion,
        # everything else direct-inserted since this test is about READ
        # visibility, not creation workflows) ---
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_staff, json={"title": "Staff task", "assignee_employee_id": staff_id}
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        staff_task_id = resp.json()["id"]
        resp = await api_client.post(
            f"/api/v1/tasks/{staff_task_id}/submit-completion", headers=headers_staff, json={"summary": "Done."}
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        staff_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Staff project',$2) returning id",
            company_id, staff_id,
        )
        await admin_conn.execute(
            """insert into goals (company_id, title, goal_type, employee_id, owner_employee_id, period_start, period_end)
               values ($1,'Staff goal','individual',$2,$2,current_date,current_date + 30)""",
            company_id, staff_id,
        )
        await admin_conn.execute(
            """insert into kpis (employee_id, name, unit, direction, target_value, weight, period_start, period_end)
               values ($1,'Staff KPI','count','higher_is_better',10,100,current_date,current_date + 30)""",
            staff_id,
        )
        await admin_conn.execute(
            "insert into kpi_scores (employee_id, period_start, period_end, computed_score, kpi_snapshot) values ($1,current_date,current_date,80,'[]'::jsonb)",
            staff_id,
        )
        await admin_conn.execute(
            "insert into recognitions (employee_id, given_by, category, message) values ($1,$2,'kudos','Great work')",
            staff_id, depthead_id,
        )

        # --- Fixture data for Manager (to test upward-leak refusal) and
        # Contributor (to test sibling-leak refusal) ---
        manager_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Manager project',$2) returning id",
            company_id, manager_id,
        )
        contributor_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Contributor project',$2) returning id",
            company_id, contributor_id,
        )

        async def visible_project_ids(headers: dict, owner_id: str) -> set[str]:
            resp = await api_client.get(f"/api/v1/projects?owner_employee_id={owner_id}", headers=headers)
            assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
            return {p["id"] for p in resp.json()}

        # (a) Manager sees Staff's full profile via hierarchy, zero grants.
        resp = await api_client.get(f"/api/v1/employees/{staff_id}/profile-summary", headers=headers_manager)
        assert resp.status_code == 200, f"manager should see staff's profile via hierarchy, got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body["position_title"] == "Staff"
        assert body["manager"]["id"] == manager_id

        resp = await api_client.get(f"/api/v1/tasks?assignee_employee_id={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and any(t["id"] == staff_task_id for t in resp.json()), "manager should see staff's task"

        assert str(staff_project_id) in await visible_project_ids(headers_manager, staff_id), "manager should see staff's project"

        resp = await api_client.get(f"/api/v1/goals?employee_id={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and len(resp.json()) >= 1, "manager should see staff's goal"

        resp = await api_client.get(f"/api/v1/kpis?employee_id={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and len(resp.json()) >= 1, "manager should see staff's kpi"

        resp = await api_client.get(f"/api/v1/scores?employee_id={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and len(resp.json()) >= 1, "manager should see staff's score"

        resp = await api_client.get(f"/api/v1/recognitions?employee_id={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and len(resp.json()) >= 1, "manager should see staff's recognition"

        resp = await api_client.get(f"/api/v1/completion-submissions?submitted_by={staff_id}", headers=headers_manager)
        assert resp.status_code == 200 and len(resp.json()) >= 1, "manager should see staff's completion submission"

        # (b) Sibling Contributor's data must NOT leak to Manager.
        resp = await api_client.get(f"/api/v1/employees/{contributor_id}/profile-summary", headers=headers_manager)
        assert resp.status_code == 404, f"contributor must not be visible to manager, got {resp.status_code}: {resp.text}"
        assert str(contributor_project_id) not in await visible_project_ids(headers_manager, contributor_id)

        # (c) DeptHead (two levels up) also sees Staff's data transitively.
        resp = await api_client.get(f"/api/v1/employees/{staff_id}/profile-summary", headers=headers_depthead)
        assert resp.status_code == 200, f"dept head should see staff transitively, got {resp.status_code}: {resp.text}"
        assert str(staff_project_id) in await visible_project_ids(headers_depthead, staff_id)

        # (d) Staff must NOT see Manager's data (no upward leak).
        resp = await api_client.get(f"/api/v1/employees/{manager_id}/profile-summary", headers=headers_staff)
        assert resp.status_code == 404, f"manager must not be visible to staff (upward), got {resp.status_code}: {resp.text}"
        assert str(manager_project_id) not in await visible_project_ids(headers_staff, manager_id)

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-e360-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            if emp_ids:
                await admin_conn.execute("delete from kpi_scores where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from recognitions where employee_id = any($1::uuid[]) or given_by = any($1::uuid[])", emp_ids)
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
