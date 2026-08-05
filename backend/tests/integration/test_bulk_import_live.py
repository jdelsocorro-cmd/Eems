"""Live test of the Bulk Import Center (042_bulk_import_center.sql +
app/services/bulk_import.py): insert/update classification, non_empty_only
vs overwrite_all field strategies, pre-commit conflict detection (work_email
matches one existing record, employee_number matches a DIFFERENT one), RLS-
scoped rejection during commit (not an engine-level permission check), no
invite email fired for bulk-inserted employees, and the `status` column
being silently ignored even when present in the CSV.

Skipped by default -- see test_user_rbac_live.py for the RUN_LIVE_TESTS=1
convention and rationale.
"""

import csv
import io
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


def _csv_bytes(header: list[str], rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


@pytest.mark.asyncio
async def test_bulk_import_employees():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:6]
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"BulkImport Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_id
        )
        manager_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Manager',$2) returning id", unit_id, f"MGR{suffix}"
        )
        reachable_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Reachable',$2,$3) returning id",
            unit_id, f"RCH{suffix}", manager_pos,
        )
        unreachable_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Unreachable',$2) returning id", unit_id, f"UNR{suffix}"
        )
        # Positions purely so admin/existing/other_existing are visible to
        # each other under employees_select RLS at all -- make_employee()
        # below inserts directly via the admin connection (bypassing RLS
        # entirely, so it always succeeds), but the API calls later run
        # under each employee's OWN RLS-scoped session, and accessible_
        # employee_ids only includes people holding a CURRENT position
        # within the caller's accessible scope. Admin's company-scope grant
        # covers every position in this company's org_units regardless of
        # which one, so any position works here.
        admin_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Admin',$2) returning id", unit_id, f"ADM{suffix}"
        )
        existing_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Existing',$2) returning id", unit_id, f"EXS{suffix}"
        )
        other_existing_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'OtherExisting',$2) returning id", unit_id, f"OEX{suffix}"
        )

        async def make_employee(email: str, first: str, phone: str | None = None) -> tuple[str, dict]:
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
                json={"email": email, "password": PASSWORD, "email_confirm": True},
            )
            resp.raise_for_status()
            auth_user_id = resp.json()["id"]
            created_auth_user_ids.append(auth_user_id)
            employee_id = await admin_conn.fetchval(
                "insert into employees (auth_user_id, first_name, last_name, work_email, phone) values ($1,$2,$3,$4,$5) returning id",
                auth_user_id, first, "BulkImport", email, phone,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_id, headers_admin = await make_employee(f"bi-admin-{suffix}@eems-live-test.dev", "Admin")
        manager_id, headers_manager = await make_employee(f"bi-mgr-{suffix}@eems-live-test.dev", "Manager")
        existing_id, _ = await make_employee(f"bi-existing-{suffix}@eems-live-test.dev", "Existing", phone="555-0000")
        other_existing_id, _ = await make_employee(f"bi-other-{suffix}@eems-live-test.dev", "Other")
        reachable_id, _ = await make_employee(f"bi-reachable-{suffix}@eems-live-test.dev", "Reachable", phone="555-1111")
        unreachable_id, _ = await make_employee(f"bi-unreachable-{suffix}@eems-live-test.dev", "Unreachable", phone="555-2222")

        for pos_id, emp_id in (
            (admin_pos, admin_id),
            (existing_pos, existing_id),
            (other_existing_pos, other_existing_id),
            (manager_pos, manager_id),
            (reachable_pos, reachable_id),
            (unreachable_pos, unreachable_id),
        ):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)", pos_id, emp_id, admin_id
            )

        # Admin: full Super Admin role (employee.create/update unscoped, employee.bulk_import).
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_id, super_admin_role_id, company_id,
        )
        # Manager: two SEPARATE roles, deliberately not combined into one --
        # employee.bulk_import granted at company scope (needed for import_
        # batches' RLS, which checks has_permission_on_company), employee.
        # update granted ONLY at position_subtree scope (covers reachable_id,
        # NOT unreachable_id). Putting both permissions on one role granted
        # at company scope would silently give manager company-wide employee.
        # update too, defeating the whole point of this scenario.
        bulk_import_perm_id = await admin_conn.fetchval(
            "select id from permissions where resource='employee' and action='bulk_import'"
        )
        update_perm_id = await admin_conn.fetchval("select id from permissions where resource='employee' and action='update'")
        bulk_import_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"BI Import Grant {suffix}"
        )
        update_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"BI Update Grant {suffix}"
        )
        await admin_conn.execute("insert into role_permissions (role_id, permission_id) values ($1,$2)", bulk_import_role_id, bulk_import_perm_id)
        await admin_conn.execute("insert into role_permissions (role_id, permission_id) values ($1,$2)", update_role_id, update_perm_id)
        # bulk_import_role_id granted at 'self' scope, deliberately NOT
        # 'company' -- app.has_permission_on_company() (used by import_
        # batches' RLS) only needs employee.bulk_import held ANYWHERE
        # (has_permission is unscoped by definition) plus company_id in
        # employee_accessible_company_ids(), which manager already
        # satisfies via their OWN current position sitting inside this
        # company (employee_accessible_company_ids includes "your current
        # company" independent of any explicit grant, see 011_org_
        # structure_visibility_via_grants.sql). A 'company'-scope grant
        # here would ALSO have widened accessible_position_ids/accessible_
        # employee_ids company-wide (that union doesn't care which
        # permission a given grant's role bundles), silently letting
        # manager reach unreachable_id too and defeating this whole
        # scenario -- confirmed the hard way, this comment exists because
        # the first version of this test got that wrong.
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'self',null,$1)",
            manager_id, bulk_import_role_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            manager_id, update_role_id, manager_pos,
        )

        # --- Batch A (admin, upsert / non_empty_only): insert a new row, update an
        # existing row leaving most fields blank (must survive), reject a row whose
        # work_email matches one existing employee but employee_number collides with
        # a DIFFERENT existing employee, and confirm a `status` column is ignored. ---
        header = ["work_email", "first_name", "last_name", "employee_number", "phone", "status"]
        rows = [
            [f"bi-new1-{suffix}@eems-live-test.dev", "New1", "BulkImport", "", "", ""],
            [f"bi-existing-{suffix}@eems-live-test.dev", "", "", "", "555-9999", "offboarded"],
            [f"bi-other-{suffix}@eems-live-test.dev", "Conflict", "Row", f"EMP-{other_existing_id}", "", ""],
        ]
        # Give other_existing_id a real employee_number, then reference a DIFFERENT
        # employee_number value that collides with a third, unrelated employee to
        # force the cross-key conflict -- simpler: give existing_id an employee_number,
        # then have the "other_existing" row's work_email target other_existing_id but
        # employee_number target existing_id's number.
        existing_number = f"NUM-{suffix}-A"
        other_number = f"NUM-{suffix}-B"
        await admin_conn.execute("update employees set employee_number = $1 where id = $2", existing_number, existing_id)
        await admin_conn.execute("update employees set employee_number = $1 where id = $2", other_number, other_existing_id)
        rows[2] = [f"bi-other-{suffix}@eems-live-test.dev", "Conflict", "Row", existing_number, "", ""]

        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_a.csv", _csv_bytes(header, rows), "text/csv")},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        batch_a = resp.json()
        assert batch_a["status"] == "previewed"
        assert batch_a["row_count"] == 3

        resp = await api_client.get(f"/api/v1/import-batches/{batch_a['id']}/rows", headers=headers_admin)
        assert resp.status_code == 200
        rows_by_email = {r["raw_data"]["work_email"]: r for r in resp.json()}
        assert rows_by_email[f"bi-new1-{suffix}@eems-live-test.dev"]["action"] == "insert"
        assert rows_by_email[f"bi-existing-{suffix}@eems-live-test.dev"]["action"] == "update"
        assert rows_by_email[f"bi-other-{suffix}@eems-live-test.dev"]["action"] == "reject", "cross-key conflict should be rejected pre-commit"

        resp = await api_client.post(f"/api/v1/import-batches/{batch_a['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        summary = resp.json()
        assert summary["inserted_count"] == 1
        assert summary["updated_count"] == 1
        assert summary["rejected_count"] == 1
        assert summary["status"] == "committed"

        new_row = await admin_conn.fetchrow(
            "select auth_user_id, first_name, last_name, status from employees where work_email = $1",
            f"bi-new1-{suffix}@eems-live-test.dev",
        )
        assert new_row is not None
        assert new_row["auth_user_id"] is None, "bulk-imported employee must NOT have an invite email fired (no auth_user_id)"
        assert new_row["first_name"] == "New1"

        updated_row = await admin_conn.fetchrow("select first_name, phone, status from employees where id = $1", existing_id)
        assert updated_row["first_name"] == "Existing", "non_empty_only must leave blank-in-CSV fields untouched"
        assert updated_row["phone"] == "555-9999", "non-blank phone should have been updated"
        assert updated_row["status"] == "active", "status column in the CSV must be silently ignored"

        # --- Batch B (admin, upsert / overwrite_all): blank phone in the CSV must
        # actually CLEAR the field, not leave it alone. ---
        header_b = ["work_email", "first_name", "last_name", "phone"]
        rows_b = [[f"bi-existing-{suffix}@eems-live-test.dev", "Existing", "BulkImport", ""]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "overwrite_all"},
            files={"file": ("batch_b.csv", _csv_bytes(header_b, rows_b), "text/csv")},
        )
        assert resp.status_code == 201
        batch_b = resp.json()
        resp = await api_client.post(f"/api/v1/import-batches/{batch_b['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["updated_count"] == 1

        cleared_row = await admin_conn.fetchrow("select phone from employees where id = $1", existing_id)
        assert cleared_row["phone"] is None, "overwrite_all with a blank cell must clear the field to NULL"

        # --- Batch C (manager, upsert): manager can update Reachable (within their
        # position_subtree). Unreachable is a row manager cannot even SEE under
        # employees_select RLS -- the staging existence-check query runs under
        # manager's own RLS session, so an invisible row looks identical to a
        # genuinely absent one and gets classified "insert" (correct: RLS must
        # never let staging reveal "a matching record exists but you can't see
        # it" -- that would be an information leak by itself). The real
        # RLS-driven rejection shows up at COMMIT: the INSERT collides with
        # unreachable's actual work_email (a real unique constraint, enforced
        # regardless of RLS visibility) and is caught and reported as rejected,
        # not silently bypassed or allowed to corrupt the rest of the batch. ---
        header_c = ["work_email", "first_name", "last_name", "phone"]
        rows_c = [
            [f"bi-reachable-{suffix}@eems-live-test.dev", "Reachable", "BulkImport", "555-3333"],
            [f"bi-unreachable-{suffix}@eems-live-test.dev", "Unreachable", "BulkImport", "555-4444"],
        ]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_manager,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_c.csv", _csv_bytes(header_c, rows_c), "text/csv")},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        batch_c = resp.json()

        resp = await api_client.get(f"/api/v1/import-batches/{batch_c['id']}/rows", headers=headers_manager)
        rows_by_email_c = {r["raw_data"]["work_email"]: r for r in resp.json()}
        assert rows_by_email_c[f"bi-reachable-{suffix}@eems-live-test.dev"]["action"] == "update"
        assert rows_by_email_c[f"bi-unreachable-{suffix}@eems-live-test.dev"]["action"] == "insert", (
            "manager can't see the existing row, so staging can only classify it as a candidate insert"
        )

        resp = await api_client.post(f"/api/v1/import-batches/{batch_c['id']}/commit", headers=headers_manager)
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        summary_c = resp.json()
        assert summary_c["updated_count"] == 1, "manager should succeed updating the reachable employee"
        assert summary_c["rejected_count"] == 1, "manager's insert attempt on the unreachable employee's email must fail, not silently succeed or corrupt data"

        reachable_row = await admin_conn.fetchrow("select phone from employees where id = $1", reachable_id)
        assert reachable_row["phone"] == "555-3333"
        unreachable_row = await admin_conn.fetchrow("select phone from employees where id = $1", unreachable_id)
        assert unreachable_row["phone"] == "555-2222", "unreachable employee's phone must be unchanged"

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%bi-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            batch_ids = await admin_conn.fetch("select id from import_batches where company_id = $1", company_id)
            batch_ids = [r["id"] for r in batch_ids]
            if batch_ids:
                await admin_conn.execute("delete from import_batch_rows where batch_id = any($1::uuid[])", batch_ids)
                await admin_conn.execute("delete from import_batches where id = any($1::uuid[])", batch_ids)

            if emp_ids:
                role_ids = await admin_conn.fetch("select id from roles where name like $1", f"%{suffix}%")
                role_ids = [r["id"] for r in role_ids]
                if role_ids:
                    await admin_conn.execute("delete from role_permissions where role_id = any($1::uuid[])", role_ids)
                    await admin_conn.execute("delete from employee_roles where role_id = any($1::uuid[])", role_ids)
                    await admin_conn.execute("delete from roles where id = any($1::uuid[])", role_ids)
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


@pytest.mark.asyncio
async def test_bulk_import_position_assignment():
    """Covers the Position Assignment Extension: org_unit_name/position_code
    resolved against the CURRENT Org Chart, never guessed -- reject-not-
    create on a missing org unit or position (with the employee write rolled
    back too, proving the shared-savepoint atomicity), occupancy conflicts,
    update-mode reassignment (old assignment closed, new one opened), the
    caller needing org_structure.manage IN ADDITION to employee.bulk_import
    (rejecting the whole row even though the employee part alone would have
    succeeded), and Revalidate recovering a row after the Org Chart is fixed
    -- no re-upload needed.
    """
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:6]
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"PosImport Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Sales',$2) returning id", company_id, "department"
        )
        unit_name = "Sales"

        async def make_position(title: str, code: str) -> str:
            return await admin_conn.fetchval(
                "insert into positions (org_unit_id, title, code) values ($1,$2,$3) returning id", unit_id, title, code
            )

        seat_open = await make_position("Rep Open", f"REP1-{suffix}")
        seat_occupied = await make_position("Rep Occupied", f"REP2-{suffix}")
        seat_old = await make_position("Rep Old", f"REP3-{suffix}")
        seat_new = await make_position("Rep New", f"REP4-{suffix}")
        seat_no_perm = await make_position("Rep NoPerm", f"REP5-{suffix}")
        # seat_pending is deliberately NOT created here -- scenario (f)
        # creates it only after the first (rejected) revalidate, to prove
        # the Org Chart fix is picked up without re-uploading the file.
        admin_seat = await make_position("Admin", f"ADM-{suffix}")

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
                auth_user_id, first, "PosImport", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_id, headers_admin = await make_employee(f"pi-admin-{suffix}@eems-live-test.dev", "Admin")
        occupant_id, _ = await make_employee(f"pi-occupant-{suffix}@eems-live-test.dev", "Occupant")
        reassign_id, _ = await make_employee(f"pi-reassign-{suffix}@eems-live-test.dev", "Reassign")
        limited_id, headers_limited = await make_employee(f"pi-limited-{suffix}@eems-live-test.dev", "Limited")

        for pos_id, emp_id in ((admin_seat, admin_id), (seat_occupied, occupant_id), (seat_old, reassign_id), (seat_no_perm, limited_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)", pos_id, emp_id, admin_id
            )

        # Admin: full Super Admin (employee.create/update, employee.bulk_import,
        # org_structure.manage -- everything scenarios a-d and f need).
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_id, super_admin_role_id, company_id,
        )

        # Limited: employee.create + employee.bulk_import, deliberately NOT
        # org_structure.manage -- proves scenario (e), a row's position-
        # assignment half failing on permission rolls back the employee half
        # too, even though employee.create alone would have succeeded.
        create_perm_id = await admin_conn.fetchval("select id from permissions where resource='employee' and action='create'")
        bulk_import_perm_id = await admin_conn.fetchval(
            "select id from permissions where resource='employee' and action='bulk_import'"
        )
        limited_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"PI Limited Grant {suffix}"
        )
        await admin_conn.execute("insert into role_permissions (role_id, permission_id) values ($1,$2)", limited_role_id, create_perm_id)
        await admin_conn.execute(
            "insert into role_permissions (role_id, permission_id) values ($1,$2)", limited_role_id, bulk_import_perm_id
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'self',null,$1)",
            limited_id, limited_role_id,
        )

        header = ["work_email", "first_name", "last_name", "org_unit_name", "position_code"]

        # --- (a) Valid insert + assign: new employee, unoccupied position. ---
        rows_a = [[f"pi-new-a-{suffix}@eems-live-test.dev", "NewA", "PosImport", unit_name, f"REP1-{suffix}"]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_a.csv", _csv_bytes(header, rows_a), "text/csv")},
        )
        assert resp.status_code == 201
        batch_a = resp.json()
        resp = await api_client.get(f"/api/v1/import-batches/{batch_a['id']}/rows", headers=headers_admin)
        assert resp.json()[0]["action"] == "insert"
        resp = await api_client.post(f"/api/v1/import-batches/{batch_a['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        assert resp.json()["inserted_count"] == 1

        new_a_id = await admin_conn.fetchval("select id from employees where work_email = $1", f"pi-new-a-{suffix}@eems-live-test.dev")
        assert new_a_id is not None
        assignment = await admin_conn.fetchrow(
            "select employee_id, is_primary from position_assignments where position_id = $1 and end_date is null", seat_open
        )
        assert assignment is not None, "position_assignments row must exist for the newly bulk-imported employee"
        assert assignment["employee_id"] == new_a_id
        assert assignment["is_primary"] is True

        # --- (b) Org unit not found: rejected, employee NOT created (atomicity). ---
        rows_b = [[f"pi-new-b-{suffix}@eems-live-test.dev", "NewB", "PosImport", f"Nonexistent Unit {suffix}", "WHATEVER"]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_b.csv", _csv_bytes(header, rows_b), "text/csv")},
        )
        batch_b = resp.json()
        resp = await api_client.post(f"/api/v1/import-batches/{batch_b['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        summary_b = resp.json()
        assert summary_b["rejected_count"] == 1
        assert summary_b["inserted_count"] == 0
        no_row = await admin_conn.fetchval("select id from employees where work_email = $1", f"pi-new-b-{suffix}@eems-live-test.dev")
        assert no_row is None, "employee must NOT be created when the org unit doesn't resolve -- reject the whole row"

        # --- (c) Position occupied by a different employee: rejected. ---
        rows_c = [[f"pi-new-c-{suffix}@eems-live-test.dev", "NewC", "PosImport", unit_name, f"REP2-{suffix}"]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_c.csv", _csv_bytes(header, rows_c), "text/csv")},
        )
        batch_c = resp.json()
        resp = await api_client.post(f"/api/v1/import-batches/{batch_c['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        assert resp.json()["rejected_count"] == 1
        no_row_c = await admin_conn.fetchval("select id from employees where work_email = $1", f"pi-new-c-{suffix}@eems-live-test.dev")
        assert no_row_c is None, "occupied position must reject the row, employee included"
        still_occupant = await admin_conn.fetchval(
            "select employee_id from position_assignments where position_id = $1 and end_date is null", seat_occupied
        )
        assert str(still_occupant) == occupant_id, "the original occupant must be undisturbed"

        # --- (d) Update-mode reassignment: old assignment closed, new one opened. ---
        rows_d = [[f"pi-reassign-{suffix}@eems-live-test.dev", "Reassign", "PosImport", unit_name, f"REP4-{suffix}"]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_d.csv", _csv_bytes(header, rows_d), "text/csv")},
        )
        batch_d = resp.json()
        resp = await api_client.post(f"/api/v1/import-batches/{batch_d['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        assert resp.json()["updated_count"] == 1
        old_current = await admin_conn.fetchval(
            "select employee_id from position_assignments where position_id = $1 and end_date is null", seat_old
        )
        assert old_current is None, "the employee's OLD assignment must be closed (end_date set), not left dangling"
        new_current = await admin_conn.fetchval(
            "select employee_id from position_assignments where position_id = $1 and end_date is null", seat_new
        )
        assert str(new_current) == reassign_id, "the employee must now hold the NEW position"

        # --- (e) Caller lacks org_structure.manage: rejected even though the
        # employee write alone would have succeeded (shared savepoint). ---
        rows_e = [[f"pi-new-e-{suffix}@eems-live-test.dev", "NewE", "PosImport", unit_name, f"REP5-{suffix}"]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_limited,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_e.csv", _csv_bytes(header, rows_e), "text/csv")},
        )
        assert resp.status_code == 201, f"staging (a pure preview) should still succeed: {resp.text}"
        batch_e = resp.json()
        resp = await api_client.post(f"/api/v1/import-batches/{batch_e['id']}/commit", headers=headers_limited)
        assert resp.status_code == 200, resp.text
        assert resp.json()["rejected_count"] == 1
        no_row_e = await admin_conn.fetchval("select id from employees where work_email = $1", f"pi-new-e-{suffix}@eems-live-test.dev")
        assert no_row_e is None, (
            "missing org_structure.manage must roll back the employee write too -- "
            "never a half-applied row where the employee exists but has no position"
        )

        # --- (f) Revalidate: fix the Org Chart after a rejection, re-check
        # without re-uploading the file. ---
        pending_code = f"REP6-{suffix}"
        rows_f = [[f"pi-new-f-{suffix}@eems-live-test.dev", "NewF", "PosImport", unit_name, pending_code]]
        resp = await api_client.post(
            "/api/v1/import-batches",
            headers=headers_admin,
            data={"module": "employees", "company_id": str(company_id), "import_mode": "upsert", "field_strategy": "non_empty_only"},
            files={"file": ("batch_f.csv", _csv_bytes(header, rows_f), "text/csv")},
        )
        batch_f = resp.json()
        resp = await api_client.get(f"/api/v1/import-batches/{batch_f['id']}/rows", headers=headers_admin)
        row_f = resp.json()[0]
        assert row_f["action"] == "reject"
        assert any("not found" in e for e in row_f["validation_errors"])

        # Fix the Org Chart -- the position didn't exist at staging time.
        await make_position("Rep Pending", pending_code)

        resp = await api_client.post(f"/api/v1/import-batches/{batch_f['id']}/revalidate", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        revalidated_rows = resp.json()
        assert revalidated_rows[0]["action"] == "insert", "after fixing the Org Chart, Revalidate must resolve the row without re-uploading"

        resp = await api_client.post(f"/api/v1/import-batches/{batch_f['id']}/commit", headers=headers_admin)
        assert resp.status_code == 200, resp.text
        assert resp.json()["inserted_count"] == 1
        new_f_id = await admin_conn.fetchval("select id from employees where work_email = $1", f"pi-new-f-{suffix}@eems-live-test.dev")
        assert new_f_id is not None

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%pi-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            batch_ids = await admin_conn.fetch("select id from import_batches where company_id = $1", company_id)
            batch_ids = [r["id"] for r in batch_ids]
            if batch_ids:
                await admin_conn.execute("delete from import_batch_rows where batch_id = any($1::uuid[])", batch_ids)
                await admin_conn.execute("delete from import_batches where id = any($1::uuid[])", batch_ids)

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
