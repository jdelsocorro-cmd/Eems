"""Integration test against a REAL Supabase database -- not mocked, not
in-memory. Exercises the actual FastAPI endpoints for the org hierarchy
CRUD + reparent flow with a real Supabase Auth token, proving:

- JWT verification, RLS role-switching, and company-scoped visibility work
  end to end (app.employee_accessible_company_ids()).
- Creating a company auto-grants the creator a scoped admin role on it
  (app.grant_company_creator_admin(), 013_scope_aware_org_structure_
  mutate.sql) -- otherwise they could never see what they just created.
- Attempting to create org-structure rows under a company you hold no
  scoped grant for is rejected with a clean 403 (not a raw 500) --
  app.has_permission_on_company() + core/error_handlers.py.
- org_units (024/025) support arbitrary depth AND a flat department ->
  position structure with no intermediate unit at all -- the specific
  capability the department/team -> org_units generalization exists for.
- The org_unit_closure subtree (GET /org-units/{id}/subtree) and the
  position_closure subtree (GET /positions/{id}/subtree) both reflect
  reality after create and after reparent.
- Reparenting logs to history with the caller's reason, and reparenting a
  node under its own descendant is rejected as a cycle (400, not 500), for
  both org_units and positions.
- Soft-delete: the row survives, the API just stops returning it.

Skipped by default (needs live Supabase credentials + network + a real
auth user). Run explicitly with:
    RUN_LIVE_TESTS=1 pytest tests/integration/test_org_hierarchy_live.py -v -s
backend/.env must be populated (see backend/.env.example).
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
TEST_PASSWORD = "Test1234!Verify"


def _admin_db_url() -> str:
    admin_env_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "supabase", ".env")
    with open(admin_env_path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line.startswith("SUPABASE_DB_ADMIN_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("SUPABASE_DB_ADMIN_URL not found in supabase/.env")


@pytest.mark.asyncio
async def test_org_hierarchy_crud_and_reparent_flow():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    test_email = f"eems-integration-test-{suffix}@eems-live-test.dev"
    auth_user_id = None

    try:
        # --- setup: real auth user + employee + bootstrap company/grant ---
        resp = await auth_client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"email": test_email, "password": TEST_PASSWORD, "email_confirm": True},
        )
        resp.raise_for_status()
        auth_user_id = resp.json()["id"]

        employee_id = await admin_conn.fetchval(
            "insert into employees (auth_user_id, first_name, last_name, work_email) values ($1,$2,$3,$4) returning id",
            auth_user_id, "Integration", "Test", test_email,
        )
        bootstrap_company_id = await admin_conn.fetchval(
            "insert into companies (name) values ($1) returning id", f"Bootstrap Co {suffix}"
        )
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            employee_id, super_admin_role_id, bootstrap_company_id,
        )

        resp = await auth_client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": test_email, "password": TEST_PASSWORD},
        )
        resp.raise_for_status()
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        # --- GET /employees/me: proves JWT -> auth.uid() -> employees row works ---
        resp = await api_client.get("/api/v1/employees/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["work_email"] == test_email

        # --- POST /companies: creator auto-granted scoped admin on the new company ---
        resp = await api_client.post("/api/v1/companies", headers=headers, json={"name": f"API Co {suffix}"})
        assert resp.status_code == 201
        created_company_id = resp.json()["id"]

        grant_count = await admin_conn.fetchval(
            "select count(*) from employee_roles where employee_id = $1 and scope_id = $2",
            employee_id, uuid.UUID(created_company_id),
        )
        assert grant_count == 1, "company creator should be auto-granted a scoped role on it"

        # --- scope enforcement: a company this employee has NO grant on must reject writes ---
        unscoped_company_id = await admin_conn.fetchval(
            "insert into companies (name) values ($1) returning id", f"Unscoped Co {suffix}"
        )
        resp = await api_client.post(
            "/api/v1/org-units", headers=headers,
            json={"company_id": str(unscoped_company_id), "name": "Should Fail", "unit_type": "department"},
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # --- flat structure: department -> position directly, no team layer.
        # This is the specific case the department/team -> org_units
        # generalization exists for (see 024_org_units.sql).
        resp = await api_client.post(
            "/api/v1/org-units", headers=headers,
            json={"company_id": str(bootstrap_company_id), "name": "Finance", "unit_type": "department"},
        )
        assert resp.status_code == 201
        finance_unit_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/positions", headers=headers,
            json={"org_unit_id": finance_unit_id, "title": "CFO", "code": f"CFO{suffix}"},
        )
        assert resp.status_code == 201, f"flat department-to-position failed: {resp.text}"

        # --- nested structure: department -> team -> position, arbitrary depth. ---
        resp = await api_client.post(
            "/api/v1/org-units", headers=headers,
            json={"company_id": str(bootstrap_company_id), "name": "Eng", "unit_type": "department"},
        )
        assert resp.status_code == 201
        eng_unit_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/org-units", headers=headers,
            json={"company_id": str(bootstrap_company_id), "name": "Backend", "unit_type": "team", "parent_unit_id": eng_unit_id},
        )
        assert resp.status_code == 201
        backend_unit_id = resp.json()["id"]

        # --- org_unit subtree reflects org_unit_closure ---
        resp = await api_client.get(f"/api/v1/org-units/{eng_unit_id}/subtree", headers=headers)
        assert resp.status_code == 200
        assert {u["id"] for u in resp.json()} == {eng_unit_id, backend_unit_id}

        # --- org_unit reparent: detach Backend, verify history, then attempt a cycle ---
        resp = await api_client.post(
            f"/api/v1/org-units/{backend_unit_id}/reparent", headers=headers,
            json={"new_parent_unit_id": None, "reason": "integration test - detach"},
        )
        assert resp.status_code == 200
        assert resp.json()["parent_unit_id"] is None

        history_count = await admin_conn.fetchval(
            "select count(*) from org_unit_hierarchy_history where org_unit_id = $1 and reason = $2",
            uuid.UUID(backend_unit_id), "integration test - detach",
        )
        assert history_count == 1

        resp = await api_client.post(
            f"/api/v1/org-units/{backend_unit_id}/reparent", headers=headers,
            json={"new_parent_unit_id": eng_unit_id},
        )
        assert resp.status_code == 200

        resp = await api_client.post(
            f"/api/v1/org-units/{eng_unit_id}/reparent", headers=headers,
            json={"new_parent_unit_id": backend_unit_id},
        )
        assert resp.status_code == 400, f"expected 400 (cycle rejected), got {resp.status_code}: {resp.text}"
        assert "cycle" in resp.text.lower()

        # --- positions under the nested unit: same reparent/subtree/cycle mechanics as before ---
        resp = await api_client.post(
            "/api/v1/positions", headers=headers,
            json={"org_unit_id": backend_unit_id, "title": "Eng Manager", "code": f"EM{suffix}"},
        )
        assert resp.status_code == 201
        manager_pos_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/positions", headers=headers,
            json={"org_unit_id": backend_unit_id, "title": "Eng II", "code": f"E2{suffix}", "reports_to_position_id": manager_pos_id},
        )
        assert resp.status_code == 201
        report_pos_id = resp.json()["id"]

        resp = await api_client.get(f"/api/v1/positions/{manager_pos_id}/subtree", headers=headers)
        assert resp.status_code == 200
        assert {p["id"] for p in resp.json()} == {manager_pos_id, report_pos_id}

        resp = await api_client.post(
            f"/api/v1/positions/{report_pos_id}/reparent", headers=headers,
            json={"new_reports_to_position_id": None, "reason": "integration test - detach"},
        )
        assert resp.status_code == 200
        assert resp.json()["reports_to_position_id"] is None

        history_count = await admin_conn.fetchval(
            "select count(*) from position_hierarchy_history where position_id = $1 and reason = $2",
            uuid.UUID(report_pos_id), "integration test - detach",
        )
        assert history_count == 1

        resp = await api_client.post(
            f"/api/v1/positions/{report_pos_id}/reparent", headers=headers,
            json={"new_reports_to_position_id": manager_pos_id},
        )
        assert resp.status_code == 200

        resp = await api_client.post(
            f"/api/v1/positions/{manager_pos_id}/reparent", headers=headers,
            json={"new_reports_to_position_id": report_pos_id},
        )
        assert resp.status_code == 400, f"expected 400 (cycle rejected), got {resp.status_code}: {resp.text}"
        assert "cycle" in resp.text.lower()

        # --- soft-delete: row survives, API hides it ---
        resp = await api_client.delete(f"/api/v1/positions/{report_pos_id}", headers=headers)
        assert resp.status_code == 204
        deleted_at = await admin_conn.fetchval("select deleted_at from positions where id = $1", uuid.UUID(report_pos_id))
        assert deleted_at is not None
        resp = await api_client.get(f"/api/v1/positions/{report_pos_id}", headers=headers)
        assert resp.status_code == 404

    finally:
        # --- cleanup: best-effort, in FK-safe order ---
        try:
            await admin_conn.execute(
                "delete from audit_log where actor_employee_id in (select id from employees where work_email = $1)",
                test_email,
            )
            await admin_conn.execute(
                "delete from employee_roles where employee_id in (select id from employees where work_email = $1)",
                test_email,
            )
            position_ids = await admin_conn.fetch(
                """select p.id from positions p
                   join org_units ou on ou.id = p.org_unit_id
                   join companies c on c.id = ou.company_id
                   where c.name like $1""",
                f"%{suffix}%",
            )
            position_ids = [r["id"] for r in position_ids]
            if position_ids:
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

            unit_ids = await admin_conn.fetch(
                "select ou.id from org_units ou join companies c on c.id = ou.company_id where c.name like $1",
                f"%{suffix}%",
            )
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

            await admin_conn.execute("delete from employees where work_email = $1", test_email)
            await admin_conn.execute(
                "delete from task_categories where company_id in (select id from companies where name like $1)",
                f"%{suffix}%",
            )
            await admin_conn.execute("delete from companies where name like $1", f"%{suffix}%")
        finally:
            if auth_user_id:
                await auth_client.delete(
                    f"{SUPABASE_URL}/auth/v1/admin/users/{auth_user_id}",
                    headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                )
            await admin_conn.close()
            await auth_client.aclose()
            await api_client.aclose()
