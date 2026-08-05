"""Live test of org-hierarchy-driven completion review escalation
(038_review_delegations_and_hierarchy_resolution.sql): the four scenarios
from Jayson's design directive --
  (a) default reviewer = immediate manager, with ZERO employee_roles grant,
  (b) fallback climbs to the next ancestor position when the immediate
      manager's position is vacant,
  (c) delegation lets an unrelated employee (zero grants, zero position in
      the chain) review on a manager's behalf, additively (the delegating
      manager keeps their own standing too),
  (d) once the WHOLE chain is vacant, only a company-wide completion.review
      holder outside the chain (fallback tier) can review -- an ordinary
      employee still cannot.

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
async def test_hierarchy_review_escalation():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"Hier Co {suffix}")
        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_id
        )

        # CEO -> DeptHead -> Manager -> Staff, plus a sibling root position (HR)
        # structurally OUTSIDE the Staff->...->CEO chain, for the fallback-tier test.
        ceo_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'CEO',$2) returning id", unit_id, f"CEO{suffix}"
        )
        depthead_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'DeptHead',$2,$3) returning id",
            unit_id, f"DH{suffix}", ceo_pos,
        )
        manager_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Manager',$2,$3) returning id",
            unit_id, f"MGR{suffix}", depthead_pos,
        )
        staff_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Staff',$2,$3) returning id",
            unit_id, f"STF{suffix}", manager_pos,
        )
        hr_pos = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'HR Root',$2) returning id", unit_id, f"HR{suffix}"
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
                auth_user_id, first, "Hier", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        ceo_id, headers_ceo = await make_employee(f"eems-hier-ceo-{suffix}@eems-live-test.dev", "Ceo")
        depthead_id, headers_depthead = await make_employee(f"eems-hier-dh-{suffix}@eems-live-test.dev", "DeptHead")
        manager_id, headers_manager = await make_employee(f"eems-hier-mgr-{suffix}@eems-live-test.dev", "Manager")
        staff_id, headers_staff = await make_employee(f"eems-hier-staff-{suffix}@eems-live-test.dev", "Staff")
        contributor_id, headers_contributor = await make_employee(f"eems-hier-contrib-{suffix}@eems-live-test.dev", "Contributor")
        hr_id, headers_hr = await make_employee(f"eems-hier-hr-{suffix}@eems-live-test.dev", "HrAdmin")

        for pos_id, emp_id in ((ceo_pos, ceo_id), (depthead_pos, depthead_id), (manager_pos, manager_id), (staff_pos, staff_id), (hr_pos, hr_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, ceo_id,
            )

        # Only HR holds a company-scope grant -- CEO/DeptHead/Manager start with
        # ZERO employee_roles rows, so any approval they can do is purely via
        # the org hierarchy, not a manual RBAC grant.
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            hr_id, super_admin_role_id, company_id,
        )

        async def new_task_submission(assignee_id: str, assignee_headers: dict, title: str) -> str:
            resp = await api_client.post(
                "/api/v1/tasks", headers=assignee_headers, json={"title": title, "assignee_employee_id": assignee_id}
            )
            assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
            task_id = resp.json()["id"]
            resp = await api_client.post(
                f"/api/v1/tasks/{task_id}/submit-completion", headers=assignee_headers, json={"summary": "Done."}
            )
            assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
            return resp.json()["id"]

        # --- (a) Manager, zero employee_roles grants, still eligible via hierarchy ---
        sub_a = await new_task_submission(staff_id, headers_staff, "Scenario A")

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_a}/approve", headers=headers_contributor, json={"completion_score": 100}
        )
        assert resp.status_code == 404, f"unrelated contributor must not be eligible, got {resp.status_code}: {resp.text}"

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_a}/approve", headers=headers_manager, json={"completion_score": 90}
        )
        assert resp.status_code == 200, f"manager (zero grants) should approve via hierarchy, got {resp.status_code}: {resp.text}"

        # --- (b) Manager's position goes vacant -> DeptHead (next ancestor) becomes eligible instead ---
        await admin_conn.execute(
            "update position_assignments set end_date = current_date where position_id = $1 and end_date is null", manager_pos
        )
        sub_b = await new_task_submission(staff_id, headers_staff, "Scenario B")

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_b}/approve", headers=headers_manager, json={"completion_score": 90}
        )
        assert resp.status_code == 404, f"vacated manager must no longer be eligible, got {resp.status_code}: {resp.text}"

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_b}/approve", headers=headers_depthead, json={"completion_score": 85}
        )
        assert resp.status_code == 200, f"dept head should be eligible once manager is vacant, got {resp.status_code}: {resp.text}"

        # --- (c) DeptHead delegates to Contributor (zero grants, zero position in the chain);
        # delegation is additive -- DeptHead keeps their own standing too ---
        resp = await api_client.post(
            "/api/v1/review-delegations", headers=headers_depthead,
            json={"delegate_employee_id": contributor_id, "reason": "Out this week"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        delegation_id = resp.json()["id"]

        sub_c1 = await new_task_submission(staff_id, headers_staff, "Scenario C1")
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_c1}/approve", headers=headers_contributor, json={"completion_score": 80}
        )
        assert resp.status_code == 200, f"delegate should be able to approve, got {resp.status_code}: {resp.text}"

        sub_c2 = await new_task_submission(staff_id, headers_staff, "Scenario C2")
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_c2}/approve", headers=headers_depthead, json={"completion_score": 80}
        )
        assert resp.status_code == 200, f"delegator should STILL be able to approve directly (additive), got {resp.status_code}: {resp.text}"

        resp = await api_client.delete(f"/api/v1/review-delegations/{delegation_id}", headers=headers_depthead)
        assert resp.status_code == 204, f"expected 204, got {resp.status_code}: {resp.text}"

        sub_c3 = await new_task_submission(staff_id, headers_staff, "Scenario C3 (after revoke)")
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_c3}/approve", headers=headers_contributor, json={"completion_score": 80}
        )
        assert resp.status_code == 404, f"revoked delegate must no longer be eligible, got {resp.status_code}: {resp.text}"

        # --- (d) Whole chain (Manager, DeptHead, CEO) vacant -> only HR (company-wide
        # completion.review holder, structurally outside the chain) is eligible ---
        await admin_conn.execute(
            "update position_assignments set end_date = current_date where position_id = any($1::uuid[]) and end_date is null",
            [depthead_pos, ceo_pos],
        )
        sub_d = await new_task_submission(staff_id, headers_staff, "Scenario D")

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_d}/approve", headers=headers_contributor, json={"completion_score": 70}
        )
        assert resp.status_code == 404, f"ordinary employee must not be eligible once chain is fully vacant, got {resp.status_code}: {resp.text}"

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{sub_d}/approve", headers=headers_hr, json={"completion_score": 70}
        )
        assert resp.status_code == 200, f"company-wide completion.review holder should be the fallback reviewer, got {resp.status_code}: {resp.text}"

        # --- Review Queue picks up hierarchy-only reviewers too, not just RBAC grants ---
        sub_e = await new_task_submission(staff_id, headers_staff, "Scenario E (review queue)")
        resp = await api_client.get("/api/v1/completion-submissions?awaiting_my_review=true", headers=headers_hr)
        assert resp.status_code == 200
        assert any(s["id"] == sub_e for s in resp.json()), "HR's review queue should include the fallback-eligible submission"

    finally:
        try:
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-hier-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

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
                await admin_conn.execute("delete from review_delegations where delegator_employee_id = any($1::uuid[]) or delegate_employee_id = any($1::uuid[])", emp_ids)
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
