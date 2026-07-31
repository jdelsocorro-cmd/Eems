"""Live test of task 8 (projects + tasks) against the real Supabase database:
project CRUD with company-scoped create/update, cross-tenant read isolation
(the leak fixed in 018_projects_select_scope_leak.sql), project membership
including the RETURNING-visibility edge case fixed in
017_scope_aware_projects_mutate.sql, task assignment scoped by position
subtree, auto-logged status history, and task comments.

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
async def test_projects_tasks_flow():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    admin_a_email = f"eems-t8-admina-{suffix}@eems-live-test.dev"
    staff_a_email = f"eems-t8-staffa-{suffix}@eems-live-test.dev"
    admin_b_email = f"eems-t8-adminb-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        # --- setup: two separate companies (A, B), each with its own Super Admin ---
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_a_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T8 Co A {suffix}")
        company_b_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T8 Co B {suffix}")

        async def make_admin(email: str, company_id) -> tuple[str, dict]:
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
                auth_user_id, "T8", "Admin", email,
            )
            await admin_conn.execute(
                "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
                employee_id, super_admin_role_id, company_id,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_a_id, headers_a = await make_admin(admin_a_email, company_a_id)
        admin_b_id, headers_b = await make_admin(admin_b_email, company_b_id)

        # staff_a reports into admin_a's company subtree via a real position assignment
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Eng','department') returning id", company_a_id
        )
        position_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Engineer',$2) returning id", unit_id, f"ENG1{suffix}"
        )
        staff_a_auth_id = (await auth_client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"email": staff_a_email, "password": PASSWORD, "email_confirm": True},
        )).json()["id"]
        created_auth_user_ids.append(staff_a_auth_id)
        staff_a_id = await admin_conn.fetchval(
            "insert into employees (auth_user_id, first_name, last_name, work_email) values ($1,$2,$3,$4) returning id",
            staff_a_auth_id, "Staff", "A", staff_a_email,
        )
        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
            position_id, staff_a_id, admin_a_id,
        )

        # --- project creation: company-scoped, owner defaults to caller ---
        resp = await api_client.post(
            "/api/v1/projects", headers=headers_a,
            json={"company_id": str(company_a_id), "name": f"Project A {suffix}"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        project = resp.json()
        assert project["owner_employee_id"] == admin_a_id, "owner should default to the creator"
        project_id = project["id"]

        # cross-company create must be rejected (017: has_permission_on_company, not bare has_permission)
        resp = await api_client.post(
            "/api/v1/projects", headers=headers_b,
            json={"company_id": str(company_a_id), "name": "Should Fail"},
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # --- cross-tenant read isolation (018 fix) ---
        # admin_b is a Super Admin (holds project.read_all) but ONLY scoped to
        # company B -- before 018 this unscoped read_all clause would have
        # shown them company A's project too.
        resp = await api_client.get("/api/v1/projects", headers=headers_b)
        assert resp.status_code == 200
        assert project_id not in {p["id"] for p in resp.json()}, "company B admin must not see company A's project"

        resp = await api_client.get(f"/api/v1/projects/{project_id}", headers=headers_b)
        assert resp.status_code == 404, "direct fetch of another tenant's project must 404 (RLS-filtered), not 200"

        # --- project membership: RETURNING-visibility regression (017) ---
        # admin_a is NOT yet a project_members row (ownership lives on
        # projects.owner_employee_id) -- adding the FIRST member exercises the
        # exact chicken-and-egg path 017 fixed via the owner-of-parent-project
        # visibility clause.
        resp = await api_client.post(
            f"/api/v1/projects/{project_id}/members", headers=headers_a,
            json={"employee_id": str(staff_a_id), "role_in_project": "contributor"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/projects/{project_id}/members", headers=headers_a)
        assert resp.status_code == 200 and len(resp.json()) == 1

        # unauthorized removal (admin_b has no rights on company A's project) must 404, not silently 204
        resp = await api_client.delete(f"/api/v1/projects/{project_id}/members/{staff_a_id}", headers=headers_b)
        assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.text}"
        still_member = await admin_conn.fetchval(
            "select count(*) from project_members where project_id = $1 and employee_id = $2",
            uuid.UUID(project_id), staff_a_id,
        )
        assert still_member == 1, "unauthorized DELETE must not have silently removed the member"

        # --- tasks: assignment scoped by position subtree, not a blanket permission ---
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_a,
            json={"project_id": project_id, "title": "Build the thing", "assignee_employee_id": str(staff_a_id)},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        task = resp.json()
        assert task["assigner_employee_id"] == admin_a_id
        assert task["status"] == "todo"
        task_id = task["id"]

        # admin_a cannot assign a task to admin_b -- outside their subtree
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_a,
            json={"title": "Should fail", "assignee_employee_id": admin_b_id},
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # --- task status history is auto-logged by the DB trigger, not client-writable ---
        resp = await api_client.get(f"/api/v1/tasks/{task_id}/history", headers=headers_a)
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) == 1 and history[0]["new_status"] == "todo" and history[0]["old_status"] is None

        resp = await api_client.patch(f"/api/v1/tasks/{task_id}", headers=headers_a, json={"status": "in_progress"})
        assert resp.status_code == 200 and resp.json()["status"] == "in_progress"

        resp = await api_client.get(f"/api/v1/tasks/{task_id}/history", headers=headers_a)
        history = resp.json()
        assert len(history) == 2
        assert history[1]["old_status"] == "todo" and history[1]["new_status"] == "in_progress"

        # --- task comments ---
        resp = await api_client.post(f"/api/v1/tasks/{task_id}/comments", headers=headers_a, json={"body": "Looks good so far"})
        assert resp.status_code == 201
        resp = await api_client.get(f"/api/v1/tasks/{task_id}/comments", headers=headers_a)
        assert resp.status_code == 200 and len(resp.json()) == 1 and resp.json()[0]["body"] == "Looks good so far"

        # outsider (admin_b) cannot see task comments on a task they have no access to
        resp = await api_client.get(f"/api/v1/tasks/{task_id}/comments", headers=headers_b)
        assert resp.status_code == 200 and resp.json() == [], "RLS should filter this to an empty list, not error"

        # --- authorized member removal actually works ---
        resp = await api_client.delete(f"/api/v1/projects/{project_id}/members/{staff_a_id}", headers=headers_a)
        assert resp.status_code == 204, f"expected 204, got {resp.status_code}: {resp.text}"
        remaining = await admin_conn.fetchval(
            "select count(*) from project_members where project_id = $1 and employee_id = $2",
            uuid.UUID(project_id), staff_a_id,
        )
        assert remaining == 0

    finally:
        try:
            company_ids = [company_a_id, company_b_id]
            await admin_conn.execute("delete from task_comments where task_id in (select id from tasks where project_id in (select id from projects where company_id = any($1::uuid[])))", company_ids)
            await admin_conn.execute("delete from task_status_history where task_id in (select id from tasks where project_id in (select id from projects where company_id = any($1::uuid[])))", company_ids)
            await admin_conn.execute("delete from tasks where project_id in (select id from projects where company_id = any($1::uuid[])) or assigner_employee_id in (select id from employees where work_email like $2)", company_ids, f"%eems-t8-%{suffix}%")
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
                await admin_conn.execute("delete from positions where id = any($1::uuid[])", position_ids)
            unit_ids = await admin_conn.fetch("select id from org_units where company_id = any($1::uuid[])", company_ids)
            unit_ids = [r["id"] for r in unit_ids]
            if unit_ids:
                await admin_conn.execute(
                    "delete from org_unit_closure where ancestor_unit_id = any($1::uuid[]) or descendant_unit_id = any($1::uuid[])",
                    unit_ids,
                )
            await admin_conn.execute("delete from org_units where company_id = any($1::uuid[])", company_ids)

            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-t8-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]
            if emp_ids:
                await admin_conn.execute("delete from employee_roles where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from position_assignments where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from audit_log where actor_employee_id = any($1::uuid[])", emp_ids)
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
