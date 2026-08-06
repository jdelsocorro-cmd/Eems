"""Live test of 043_reachable_employee_ids_shared_visibility.sql -- the parts
of the fix Performance Review Center's own test doesn't exercise:
milestones_select (which never had EITHER visibility branch before this
migration) and completion_submissions_select's project/milestone branches
(which shared projects_select's gap). Also a superset sanity check: a caller
with zero RBAC grants AND zero position (a true outsider) must still see
nothing beyond themselves anywhere, proving app.reachable_employee_ids()
expanded visibility correctly rather than accidentally becoming "everyone".

Tree: DeptHead -> Manager -> Staff, plus a structurally unrelated sibling
Contributor position (same shape as test_employee_360_live.py and
test_performance_review_center_live.py, reused for consistency).
ScopedReviewer holds NO position at all -- only a position_subtree grant
scoped to Manager's position -- isolating the RBAC-grant path exactly like
test_performance_review_center_live.py's ScopedReviewer. PureOutsider holds
neither a position nor any employee_roles grant.

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
async def test_reachable_employee_ids_fixes_milestones_and_completion_submissions():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    created_auth_user_ids = []

    try:
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"RLSC Co {suffix}")
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
                auth_user_id, first, "RLSC", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        depthead_id, _ = await make_employee(f"eems-rlsc-dh-{suffix}@eems-live-test.dev", "DeptHead")
        manager_id, _ = await make_employee(f"eems-rlsc-mgr-{suffix}@eems-live-test.dev", "Manager")
        staff_id, headers_staff = await make_employee(f"eems-rlsc-staff-{suffix}@eems-live-test.dev", "Staff")
        contributor_id, headers_contributor = await make_employee(f"eems-rlsc-ctr-{suffix}@eems-live-test.dev", "Contributor")
        scoped_reviewer_id, headers_scoped_reviewer = await make_employee(
            f"eems-rlsc-sr-{suffix}@eems-live-test.dev", "ScopedReviewer"
        )
        # Zero position, zero employee_roles grants -- a true outsider, for
        # the "expansion didn't become everyone" sanity check.
        outsider_id, headers_outsider = await make_employee(f"eems-rlsc-out-{suffix}@eems-live-test.dev", "PureOutsider")

        for pos_id, emp_id in ((depthead_pos, depthead_id), (manager_pos, manager_id), (staff_pos, staff_id), (contributor_pos, contributor_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, depthead_id,
            )

        scoped_role_id = await admin_conn.fetchval(
            "insert into roles (company_id, name) values ($1,$2) returning id", company_id, f"RLSC Scoped Reviewer {suffix}"
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            scoped_reviewer_id, scoped_role_id, manager_pos,
        )

        # --- Fixture data: a project + milestone + project-type completion
        # submission for both Staff (in-scope) and Contributor (sibling,
        # must stay invisible). ---
        staff_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Staff project',$2) returning id",
            company_id, staff_id,
        )
        staff_milestone_id = await admin_conn.fetchval(
            "insert into milestones (project_id, name) values ($1,'Staff milestone') returning id", staff_project_id
        )
        resp = await api_client.post(
            "/api/v1/projects/" + str(staff_project_id) + "/submit-completion",
            headers=headers_staff,
            json={"summary": "Staff project done."},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        staff_project_submission_id = resp.json()["id"]

        contributor_project_id = await admin_conn.fetchval(
            "insert into projects (company_id, name, owner_employee_id) values ($1,'Contributor project',$2) returning id",
            company_id, contributor_id,
        )
        contributor_milestone_id = await admin_conn.fetchval(
            "insert into milestones (project_id, name) values ($1,'Contributor milestone') returning id", contributor_project_id
        )
        resp = await api_client.post(
            "/api/v1/projects/" + str(contributor_project_id) + "/submit-completion",
            headers=headers_contributor,
            json={"summary": "Contributor project done."},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        contributor_project_submission_id = resp.json()["id"]

        # (a) ScopedReviewer -- RBAC position_subtree grant, no position of
        # their own -- can now see Staff's milestone via the new
        # milestones_select branch, but not Contributor's (sibling).
        resp = await api_client.get(f"/api/v1/milestones?project_id={staff_project_id}", headers=headers_scoped_reviewer)
        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        assert any(m["id"] == str(staff_milestone_id) for m in resp.json()), "ScopedReviewer should see Staff's milestone (043 fix)"

        resp = await api_client.get(f"/api/v1/milestones?project_id={contributor_project_id}", headers=headers_scoped_reviewer)
        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        assert not any(m["id"] == str(contributor_milestone_id) for m in resp.json()), (
            "ScopedReviewer must NOT see Contributor's (sibling) milestone"
        )

        # (b) ScopedReviewer can now see Staff's project-type completion
        # submission via the new completion_submissions_select branch, but
        # not Contributor's.
        resp = await api_client.get("/api/v1/completion-submissions?entity_type=project", headers=headers_scoped_reviewer)
        assert resp.status_code == 200, f"{resp.status_code}: {resp.text}"
        submission_ids = {s["id"] for s in resp.json()}
        assert staff_project_submission_id in submission_ids, "ScopedReviewer should see Staff's project completion submission (043 fix)"
        assert contributor_project_submission_id not in submission_ids, (
            "ScopedReviewer must NOT see Contributor's (sibling) project completion submission"
        )

        # (c) PureOutsider: zero grants, zero position -- app.reachable_
        # employee_ids() must resolve to just themselves everywhere. If this
        # ever starts returning Staff's data, the expansion became "everyone"
        # instead of a correctly scoped superset.
        resp = await api_client.get("/api/v1/employees", headers=headers_outsider)
        assert resp.status_code == 200
        visible_employee_ids = {e["id"] for e in resp.json()}
        assert visible_employee_ids == {outsider_id}, f"PureOutsider should see only themselves, saw {visible_employee_ids}"

        resp = await api_client.get(f"/api/v1/milestones?project_id={staff_project_id}", headers=headers_outsider)
        assert resp.status_code == 200 and resp.json() == [], "PureOutsider must not see Staff's milestone"

        resp = await api_client.get("/api/v1/completion-submissions?entity_type=project", headers=headers_outsider)
        assert resp.status_code == 200
        assert staff_project_submission_id not in {s["id"] for s in resp.json()}, "PureOutsider must not see Staff's project submission"

        resp = await api_client.get("/api/v1/projects", headers=headers_outsider)
        assert resp.status_code == 200
        assert str(staff_project_id) not in {p["id"] for p in resp.json()}, "PureOutsider must not see Staff's project"

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-rlsc-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            if emp_ids:
                project_ids = await admin_conn.fetch("select id from projects where owner_employee_id = any($1::uuid[])", emp_ids)
                project_ids = [r["id"] for r in project_ids]
                if project_ids:
                    await admin_conn.execute(
                        "delete from completion_evidence_links where submission_id in (select id from completion_submissions where entity_type in ('project','milestone') and entity_id = any($1::uuid[]))",
                        project_ids,
                    )
                    await admin_conn.execute(
                        "delete from completion_submissions where entity_type = 'project' and entity_id = any($1::uuid[])", project_ids
                    )
                    milestone_ids = await admin_conn.fetch("select id from milestones where project_id = any($1::uuid[])", project_ids)
                    milestone_ids = [r["id"] for r in milestone_ids]
                    if milestone_ids:
                        await admin_conn.execute(
                            "delete from completion_submissions where entity_type = 'milestone' and entity_id = any($1::uuid[])",
                            milestone_ids,
                        )
                        await admin_conn.execute("delete from milestones where id = any($1::uuid[])", milestone_ids)
                    await admin_conn.execute("delete from projects where id = any($1::uuid[])", project_ids)

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
