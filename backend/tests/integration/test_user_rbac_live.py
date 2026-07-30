"""Live test of task 7 (user management + RBAC admin) against the real
Supabase database: employee CRUD (including the invite-failure error path),
position assignment/reassignment, offboarding, and RBAC admin (roles,
role_permissions, employee_roles) with scope enforcement.

Skipped by default -- see test_org_hierarchy_live.py for the same
RUN_LIVE_TESTS=1 convention and rationale.
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
async def test_user_management_and_rbac_admin_flow():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    admin_email = f"eems-t7-admin-{suffix}@eems-live-test.dev"
    staff_email = f"eems-t7-staff-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        # --- setup: admin test user + bootstrap company/grant/org structure ---
        resp = await auth_client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
            json={"email": admin_email, "password": PASSWORD, "email_confirm": True},
        )
        resp.raise_for_status()
        admin_auth_user_id = resp.json()["id"]
        created_auth_user_ids.append(admin_auth_user_id)

        admin_employee_id = await admin_conn.fetchval(
            "insert into employees (auth_user_id, first_name, last_name, work_email) values ($1,$2,$3,$4) returning id",
            admin_auth_user_id, "T7", "Admin", admin_email,
        )
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T7 Co {suffix}")
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_employee_id, super_admin_role_id, company_id,
        )

        dept_id = await admin_conn.fetchval(
            "insert into departments (company_id, name, code) values ($1,'Eng',$2) returning id", company_id, f"ENG{suffix}"
        )
        team_id = await admin_conn.fetchval(
            "insert into teams (department_id, name, code) values ($1,'Backend',$2) returning id", dept_id, f"BE{suffix}"
        )
        position_id = await admin_conn.fetchval(
            "insert into positions (team_id, title, code) values ($1,'Engineer',$2) returning id", team_id, f"ENG1{suffix}"
        )
        other_position_id = await admin_conn.fetchval(
            "insert into positions (team_id, title, code) values ($1,'Engineer II',$2) returning id", team_id, f"ENG2{suffix}"
        )

        resp = await auth_client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": admin_email, "password": PASSWORD},
        )
        resp.raise_for_status()
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

        # --- employee creation: pending (no invite) ---
        resp = await api_client.post(
            "/api/v1/employees", headers=headers,
            json={"first_name": "Pending", "last_name": "Hire", "work_email": staff_email, "send_invite": False},
        )
        assert resp.status_code == 201
        staff_employee = resp.json()
        assert staff_employee["auth_user_id"] is None

        # creator can see what they created, even with no position assignment yet
        resp = await api_client.get(f"/api/v1/employees/{staff_employee['id']}", headers=headers)
        assert resp.status_code == 200

        # invite failure (non-deliverable test domain) surfaces as a clean 502,
        # not a raw 500 -- see verify_task7.py history for why a real
        # successful-invite test isn't run here (would send a real email).
        resp = await api_client.post(
            "/api/v1/employees", headers=headers,
            json={
                "first_name": "Invited", "last_name": "Hire",
                "work_email": f"eems-t7-invited-{suffix}@eems-live-test.dev", "send_invite": True,
            },
        )
        assert resp.status_code == 502, f"expected 502, got {resp.status_code}: {resp.text}"
        assert "invite" in resp.json()["detail"].lower()

        # --- position assignment + reassignment ---
        resp = await api_client.post(
            "/api/v1/position-assignments", headers=headers,
            json={"position_id": str(position_id), "employee_id": staff_employee["id"]},
        )
        assert resp.status_code == 201
        assignment_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/position-assignments", headers=headers,
            json={"position_id": str(other_position_id), "employee_id": staff_employee["id"]},
        )
        assert resp.status_code == 201

        old_assignment_end_date = await admin_conn.fetchval(
            "select end_date from position_assignments where id = $1", uuid.UUID(assignment_id)
        )
        assert old_assignment_end_date is not None, "reassignment should close the old assignment"

        # --- RBAC: role creation, scope enforcement ---
        resp = await api_client.post(
            "/api/v1/roles", headers=headers, json={"name": f"Custom Role {suffix}", "company_id": str(company_id)},
        )
        assert resp.status_code == 201
        custom_role_id = resp.json()["id"]

        unscoped_company_id = await admin_conn.fetchval(
            "insert into companies (name) values ($1) returning id", f"T7 Unscoped Co {suffix}"
        )
        resp = await api_client.post(
            "/api/v1/roles", headers=headers, json={"name": "Should Fail", "company_id": str(unscoped_company_id)},
        )
        assert resp.status_code == 403, "creating a role for a company we don't manage must be rejected"

        # --- RBAC: permission catalog + role_permissions grant ---
        resp = await api_client.get("/api/v1/permissions", headers=headers)
        assert resp.status_code == 200 and len(resp.json()) > 0
        perm = next(p for p in resp.json() if p["resource"] == "kpi" and p["action"] == "update_value")

        resp = await api_client.post(f"/api/v1/roles/{custom_role_id}/permissions", headers=headers, json={"permission_id": perm["id"]})
        assert resp.status_code == 204

        resp = await api_client.get(f"/api/v1/roles/{custom_role_id}/permissions", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1 and resp.json()[0]["id"] == perm["id"]

        # --- RBAC: revoking a permission from a SYSTEM role must fail loudly (404), not silently "succeed" (204) ---
        # Regression test: found via browser testing that a bare `DELETE ...
        # WHERE` whose row role_permissions_mutate's RLS policy filters out
        # is NOT a Postgres error (unlike INSERT's WITH CHECK) -- it just
        # matches zero rows. The original endpoint didn't check for that and
        # always returned 204, meaning the client had no way to tell
        # "actually revoked" from "silently blocked and did nothing." Super
        # Admin (company_id null) can never have its permissions edited via
        # the API by design (015_scope_aware_rbac_mutate.sql).
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        org_structure_manage_perm_id = await admin_conn.fetchval(
            "select id from permissions where resource = 'org_structure' and action = 'manage'"
        )
        resp = await api_client.delete(
            f"/api/v1/roles/{super_admin_role_id}/permissions/{org_structure_manage_perm_id}", headers=headers
        )
        assert resp.status_code == 404, f"expected 404 (system role, RLS-blocked), got {resp.status_code}: {resp.text}"
        still_granted = await admin_conn.fetchval(
            "select count(*) from role_permissions where role_id = $1 and permission_id = $2",
            super_admin_role_id, org_structure_manage_perm_id,
        )
        assert still_granted == 1, "Super Admin's permission must still be intact -- the DELETE must not have silently succeeded"

        # --- RBAC: revoking a permission from our OWN company-scoped role must actually work ---
        resp = await api_client.delete(f"/api/v1/roles/{custom_role_id}/permissions/{perm['id']}", headers=headers)
        assert resp.status_code == 204, f"expected 204, got {resp.status_code}: {resp.text}"
        resp = await api_client.get(f"/api/v1/roles/{custom_role_id}/permissions", headers=headers)
        assert resp.status_code == 200 and len(resp.json()) == 0

        # --- RBAC: employee_roles grant, scope enforcement, revoke ---
        resp = await api_client.post(
            "/api/v1/employee-roles", headers=headers,
            json={"employee_id": staff_employee["id"], "role_id": custom_role_id, "scope_type": "company", "scope_id": str(company_id)},
        )
        assert resp.status_code == 201
        grant_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/employee-roles", headers=headers,
            json={"employee_id": staff_employee["id"], "role_id": custom_role_id, "scope_type": "company", "scope_id": str(unscoped_company_id)},
        )
        assert resp.status_code == 403, "granting a role scoped to a company we don't manage must be rejected"

        resp = await api_client.delete(f"/api/v1/employee-roles/{grant_id}", headers=headers)
        assert resp.status_code == 204
        remaining = await admin_conn.fetchval("select count(*) from employee_roles where id = $1", uuid.UUID(grant_id))
        assert remaining == 0

        # --- offboarding: status change, assignment closed, roles expired ---
        resp = await api_client.post(f"/api/v1/employees/{staff_employee['id']}/offboard", headers=headers, json={})
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["status"] == "offboarded"

        open_assignments = await admin_conn.fetchval(
            "select count(*) from position_assignments where employee_id = $1 and end_date is null",
            uuid.UUID(staff_employee["id"]),
        )
        assert open_assignments == 0, "offboarding should close all open position assignments"

    finally:
        try:
            company_ids = await admin_conn.fetch("select id from companies where name like $1", f"%T7%{suffix}%")
            company_ids = [r["id"] for r in company_ids]
            if company_ids:
                position_ids = await admin_conn.fetch(
                    """select p.id from positions p join teams t on t.id = p.team_id
                       join departments d on d.id = t.department_id where d.company_id = any($1::uuid[])""",
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
                await admin_conn.execute(
                    "delete from teams where department_id in (select id from departments where company_id = any($1::uuid[]))", company_ids
                )
                await admin_conn.execute("delete from departments where company_id = any($1::uuid[])", company_ids)

            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-t7-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]
            if emp_ids:
                await admin_conn.execute("delete from employee_roles where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from audit_log where actor_employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("update employees set created_by = null where created_by = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from employees where id = any($1::uuid[])", emp_ids)

            if company_ids:
                await admin_conn.execute(
                    "delete from role_permissions where role_id in (select id from roles where company_id = any($1::uuid[]))", company_ids
                )
                await admin_conn.execute("delete from roles where company_id = any($1::uuid[])", company_ids)
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
