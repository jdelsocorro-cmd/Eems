"""Live test of 044_employees_select_unassigned_visibility.sql -- found via
live-testing Org Chart's Assign Consultant feature: its "Existing Employee"
picker showed zero candidates because employees_select's only visibility
paths for an employee with no current position (accessible_employee_ids,
hierarchy_subtree_employee_ids, both position_assignments-based) plus
"created_by = you" left an unassigned employee invisible to everyone except
whoever personally created them -- including a Super Admin.

Tree: Manager -> Staff (a normal reporting line, so app.reachable_employee_
ids() has a real hierarchy branch to prove is untouched), plus an Unassigned
employee created by Manager but with no position_assignment at all.
ScopeHolder holds org_structure.manage granted at company scope but is
otherwise a structural outsider (no position, not Unassigned's creator) --
isolates the new 044 branch from every other visibility path.
PureOutsider holds neither a position nor any employee_roles grant, same
role this file's siblings (test_rls_consistency_live.py) use to prove an
expansion didn't quietly become "everyone".

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
async def test_unassigned_employee_visible_to_scoped_permission_holder_not_others():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    created_auth_user_ids = []

    try:
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"UEV Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_id
        )
        manager_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Manager',$2) returning id", unit_id, f"MGR{suffix}"
        )
        staff_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Staff',$2,$3) returning id",
            unit_id, f"STF{suffix}", manager_pos,
        )
        vacant_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Open Seat',$2) returning id", unit_id, f"VAC{suffix}"
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
                auth_user_id, first, "UEV", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        manager_id, headers_manager = await make_employee(f"eems-uev-mgr-{suffix}@eems-live-test.dev", "Manager")
        staff_id, _ = await make_employee(f"eems-uev-staff-{suffix}@eems-live-test.dev", "Staff")
        scope_holder_id, headers_scope_holder = await make_employee(f"eems-uev-sh-{suffix}@eems-live-test.dev", "ScopeHolder")
        narrow_holder_id, headers_narrow_holder = await make_employee(f"eems-uev-nh-{suffix}@eems-live-test.dev", "NarrowScopeHolder")
        outsider_id, headers_outsider = await make_employee(f"eems-uev-out-{suffix}@eems-live-test.dev", "PureOutsider")

        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)", manager_pos, manager_id, manager_id
        )
        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)", staff_pos, staff_id, manager_id
        )

        # Two permission holders, deliberately scoped differently, because
        # the assign workflow and the visibility-isolation check pull in
        # opposite directions:
        #  - ScopeHolder: org_structure.manage at COMPANY scope, same shape
        #    every real org_structure.manage role in EEMS uses (e.g. Super
        #    Admin). Needed because position_assignments_mutate
        #    (016_scope_aware_position_assignments.sql) requires
        #    has_permission_on_company(), not just bare has_permission() --
        #    used below to prove the real assign action (not just visibility)
        #    works end to end. This persona ALSO gains accessible_employee_
        #    ids() visibility into Staff via accessible_position_ids()'s
        #    company branch -- correct, pre-existing behavior for a
        #    company-scoped grant (013), not something to assert against.
        #  - NarrowScopeHolder: org_structure.manage scoped ONLY to the
        #    standalone vacant_pos (position_subtree), which never reaches
        #    Manager/Staff's branch. Isolates whether 044's NEW bare-
        #    permission branch specifically leaks visibility into ASSIGNED
        #    employees outside reach -- assertion (e) below.
        org_structure_permission_id = await admin_conn.fetchval(
            "select id from permissions where resource = 'org_structure' and action = 'manage'"
        )
        scope_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"UEV Scope Holder {suffix}"
        )
        await admin_conn.execute("insert into role_permissions (role_id, permission_id) values ($1,$2)", scope_role_id, org_structure_permission_id)
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            scope_holder_id, scope_role_id, company_id,
        )

        narrow_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"UEV Narrow Scope Holder {suffix}"
        )
        await admin_conn.execute("insert into role_permissions (role_id, permission_id) values ($1,$2)", narrow_role_id, org_structure_permission_id)
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            narrow_holder_id, narrow_role_id, vacant_pos,
        )

        # Manager creates Unassigned but never gives them a position -- same
        # shape a bulk import or an offboarding-without-replacement leaves
        # behind.
        unassigned_id = await admin_conn.fetchval(
            "insert into employees (first_name, last_name, work_email, created_by) values ($1,$2,$3,$4) returning id",
            "Unassigned", "UEV", f"eems-uev-unassigned-{suffix}@eems-live-test.dev", manager_id,
        )

        # (a) Creator (Manager) can always see Unassigned -- unchanged,
        # pre-existing created_by branch (014).
        resp = await api_client.get("/api/v1/employees", headers=headers_manager)
        assert resp.status_code == 200
        assert str(unassigned_id) in {e["id"] for e in resp.json()}, "Creator should see the employee they created (014, untouched)"

        # (b) ScopeHolder -- NOT the creator, no position, no hierarchy path
        # to Unassigned -- can now see them via 044's new branch, and can
        # actually complete the real assignment workflow through it.
        resp = await api_client.get("/api/v1/employees", headers=headers_scope_holder)
        assert resp.status_code == 200
        assert str(unassigned_id) in {e["id"] for e in resp.json()}, "org_structure.manage holder should see unassigned employee across creator boundary (044 fix)"

        resp = await api_client.post(
            "/api/v1/position-assignments",
            headers=headers_scope_holder,
            json={"position_id": str(vacant_pos), "employee_id": str(unassigned_id)},
        )
        assert resp.status_code == 201, f"ScopeHolder should be able to assign the now-visible employee: {resp.status_code}: {resp.text}"

        # (c) Once assigned, Unassigned now has a company via their
        # position -- 044's branch requires NO current primary assignment,
        # so it stops applying. Visibility from here on is governed entirely
        # by reachable_employee_ids/created_by, same as any other assigned
        # employee -- confirmed by the RLS-recursion-safety property that
        # this GET still succeeds rather than erroring.
        resp = await api_client.get("/api/v1/employees", headers=headers_scope_holder)
        assert resp.status_code == 200

        # (d) PureOutsider -- zero grants, zero position, not the creator --
        # must NOT see Unassigned. Proves 044 didn't become "everyone can see
        # every unassigned employee".
        resp = await admin_conn.fetchval(
            "select 1 from position_assignments where employee_id = $1 and position_id = $2 and end_date is null", unassigned_id, vacant_pos
        )
        assert resp == 1, "sanity check: assignment from (b) actually committed"

        second_unassigned_id = await admin_conn.fetchval(
            "insert into employees (first_name, last_name, work_email, created_by) values ($1,$2,$3,$4) returning id",
            "StillUnassigned", "UEV", f"eems-uev-unassigned2-{suffix}@eems-live-test.dev", manager_id,
        )
        resp = await api_client.get("/api/v1/employees", headers=headers_outsider)
        assert resp.status_code == 200
        visible_ids = {e["id"] for e in resp.json()}
        assert str(second_unassigned_id) not in visible_ids, "PureOutsider (no org_structure.manage/employee.create) must NOT see an unassigned employee they didn't create"
        assert visible_ids == {outsider_id}, f"PureOutsider should see only themselves, saw {visible_ids}"

        # (e) 013's blanket-visibility hole stays closed: NarrowScopeHolder
        # (org_structure.manage scoped only to the standalone vacant_pos, no
        # position of their own, no reach into Manager/Staff's branch) must
        # still NOT see Staff, an ASSIGNED employee entirely outside that
        # scope -- 044's branch only ever applies to rows with no current
        # primary assignment, so it can't be the thing granting this.
        resp = await api_client.get("/api/v1/employees", headers=headers_narrow_holder)
        assert resp.status_code == 200
        narrow_visible_ids = {e["id"] for e in resp.json()}
        assert str(staff_id) not in narrow_visible_ids, "org_structure.manage holder must NOT gain blanket visibility into assigned employees outside their scope (013's fix stays intact)"

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-uev-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

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
