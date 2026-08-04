"""Live test of Phase 2 (evidence-based completion scoring + recursive org
rollup) against the real Supabase database: the submit -> approve -> KPI-
recompute path, rejection leaving the KPI untouched, an outsider unable to
approve someone else's submission, approving twice being rejected (the
RETURNING-then-check fix in completion.py), and the recursive position
rollup producing a depth-ordered result on a 3-level fake tree
(CEO -> Manager -> Staff).

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
async def test_completion_workflow_and_rollup():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    ceo_email = f"eems-p2-ceo-{suffix}@eems-live-test.dev"
    mgr_email = f"eems-p2-mgr-{suffix}@eems-live-test.dev"
    staff_email = f"eems-p2-staff-{suffix}@eems-live-test.dev"
    outsider_email = f"eems-p2-outsider-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        manager_role_id = await admin_conn.fetchval("select id from roles where name = 'Manager'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"P2 Co {suffix}")
        outsider_company_id = await admin_conn.fetchval(
            "insert into companies (name) values ($1) returning id", f"P2 Outsider Co {suffix}"
        )

        unit_id = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Eng','department') returning id", company_id
        )
        ceo_pos_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'CEO',$2) returning id", unit_id, f"CEO{suffix}"
        )
        mgr_pos_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Manager',$2,$3) returning id",
            unit_id, f"MGR{suffix}", ceo_pos_id,
        )
        staff_pos_id = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code, reports_to_position_id) values ($1,'Staff',$2,$3) returning id",
            unit_id, f"STF{suffix}", mgr_pos_id,
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
                auth_user_id, first, "P2", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        ceo_id, headers_ceo = await make_employee(ceo_email, "Ceo")
        mgr_id, headers_mgr = await make_employee(mgr_email, "Mgr")
        staff_id, headers_staff = await make_employee(staff_email, "Staff")
        outsider_id, headers_outsider = await make_employee(outsider_email, "Outsider")

        for pos_id, emp_id in ((ceo_pos_id, ceo_id), (mgr_pos_id, mgr_id), (staff_pos_id, staff_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, ceo_id,
            )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            ceo_id, super_admin_role_id, company_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'position_subtree',$3,$1)",
            mgr_id, manager_role_id, mgr_pos_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            outsider_id, super_admin_role_id, outsider_company_id,
        )

        # --- KPI for staff, target 100 so completion_score (0-100) maps 1:1 to ratio ---
        resp = await api_client.post(
            "/api/v1/kpis", headers=headers_ceo,
            json={
                "employee_id": staff_id, "name": "Delivery quality", "unit": "score",
                "direction": "higher_is_better", "target_value": 100, "weight": 100,
                "period_start": "2026-01-01", "period_end": "2026-03-31",
            },
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        kpi_id = resp.json()["id"]

        # --- task assigned to staff by mgr, linked as evidence for the KPI ---
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_mgr,
            json={"title": "Ship the report", "assignee_employee_id": staff_id},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        task_id = resp.json()["id"]

        resp = await api_client.post(f"/api/v1/kpis/{kpi_id}/tasks/{task_id}", headers=headers_ceo, json={"weight": 1})
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        # --- staff submits completion with evidence ---
        resp = await api_client.post(
            f"/api/v1/tasks/{task_id}/submit-completion", headers=headers_staff,
            json={"summary": "Shipped the report to the client.", "evidence_links": [{"url": "https://drive.example/doc", "label": "Report"}]},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        submission_id = resp.json()["id"]
        assert resp.json()["status"] == "pending"

        # an unrelated outsider (no relationship to staff/this company) cannot approve it
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{submission_id}/approve", headers=headers_outsider, json={"completion_score": 100}
        )
        assert resp.status_code == 404, f"expected 404, got {resp.status_code}: {resp.text}"

        # --- manager (assigner) approves with a score of 80 ---
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{submission_id}/approve", headers=headers_mgr, json={"completion_score": 80}
        )
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["status"] == "approved"

        kpi_current_value = await admin_conn.fetchval("select current_value from kpis where id = $1", uuid.UUID(kpi_id))
        assert float(kpi_current_value) == 80.0, f"expected KPI current_value=80 from the single linked task, got {kpi_current_value}"

        # --- approving the same submission again is rejected, not a silent no-op ---
        resp = await api_client.post(
            f"/api/v1/completion-submissions/{submission_id}/approve", headers=headers_mgr, json={"completion_score": 50}
        )
        assert resp.status_code == 404, f"expected 404 (already reviewed), got {resp.status_code}: {resp.text}"
        kpi_current_value_after = await admin_conn.fetchval("select current_value from kpis where id = $1", uuid.UUID(kpi_id))
        assert float(kpi_current_value_after) == 80.0, "a rejected re-approval must not have changed the KPI"

        # --- a second task, submitted then REJECTED, must not touch the KPI ---
        resp = await api_client.post(
            "/api/v1/tasks", headers=headers_mgr, json={"title": "Second task", "assignee_employee_id": staff_id}
        )
        task2_id = resp.json()["id"]
        resp = await api_client.post(f"/api/v1/kpis/{kpi_id}/tasks/{task2_id}", headers=headers_ceo, json={"weight": 1})
        assert resp.status_code == 201

        resp = await api_client.post(
            f"/api/v1/tasks/{task2_id}/submit-completion", headers=headers_staff, json={"summary": "Attempt 1"}
        )
        submission2_id = resp.json()["id"]

        resp = await api_client.post(
            f"/api/v1/completion-submissions/{submission2_id}/reject", headers=headers_mgr,
            json={"rejection_feedback": "Needs more detail in the summary."},
        )
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["status"] == "rejected"

        kpi_current_value_after_reject = await admin_conn.fetchval("select current_value from kpis where id = $1", uuid.UUID(kpi_id))
        assert float(kpi_current_value_after_reject) == 80.0, "rejection must not change the KPI (task2 has no approved score yet)"

        # --- recursive rollup: staff scores 40%, so mgr (staff's only report) = 40, ceo (mgr's only report) = 40 ---
        resp = await api_client.post(
            "/api/v1/scores/compute", headers=headers_ceo,
            json={"employee_id": staff_id, "period_start": "2026-01-01", "period_end": "2026-03-31"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        assert resp.json()["computed_score"] == 80.0, f"expected 80/100=80.0, got {resp.json()['computed_score']}"

        resp = await api_client.post(
            "/api/v1/scores/compute-rollup", headers=headers_ceo,
            json={"company_id": str(company_id), "period_start": "2026-01-01", "period_end": "2026-03-31"},
        )
        assert resp.status_code == 204, f"expected 204, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/scores/position-scores?position_id={staff_pos_id}", headers=headers_ceo)
        assert resp.status_code == 200 and resp.json()[0]["computed_score"] == 80.0

        resp = await api_client.get(f"/api/v1/scores/position-scores?position_id={mgr_pos_id}", headers=headers_ceo)
        assert resp.status_code == 200 and resp.json()[0]["computed_score"] == 80.0, "manager's only report is staff (80), so manager's rollup should also be 80"

        resp = await api_client.get(f"/api/v1/scores/position-scores?position_id={ceo_pos_id}", headers=headers_ceo)
        assert resp.status_code == 200 and resp.json()[0]["computed_score"] == 80.0, "CEO's only report is manager (80, itself rolled up from staff), so CEO's rollup should also be 80"

    finally:
        try:
            company_ids = [company_id, outsider_company_id]
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-p2-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            task_ids = await admin_conn.fetch(
                "select id from tasks where assignee_employee_id = any($1::uuid[])", emp_ids
            )
            task_ids = [r["id"] for r in task_ids]
            if task_ids:
                await admin_conn.execute("delete from completion_evidence_links where submission_id in (select id from completion_submissions where entity_type = 'task' and entity_id = any($1::uuid[]))", task_ids)
                await admin_conn.execute("delete from completion_submissions where entity_type = 'task' and entity_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from kpi_tasks where task_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from task_status_history where task_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from task_comments where task_id = any($1::uuid[])", task_ids)
                await admin_conn.execute("delete from tasks where id = any($1::uuid[])", task_ids)

            if emp_ids:
                await admin_conn.execute("delete from kpi_scores where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from kpi_change_log where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpi_value_history where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpis where employee_id = any($1::uuid[])", emp_ids)

            position_ids = await admin_conn.fetch(
                "select p.id from positions p join org_units ou on ou.id = p.org_unit_id where ou.company_id = any($1::uuid[])",
                company_ids,
            )
            position_ids = [r["id"] for r in position_ids]
            if position_ids:
                await admin_conn.execute("delete from position_scores where position_id = any($1::uuid[])", position_ids)
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
            await admin_conn.execute("delete from org_units where company_id = any($1::uuid[])", company_ids)

            if emp_ids:
                await admin_conn.execute("delete from employee_roles where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from position_assignments where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from recognitions where employee_id = any($1::uuid[]) or given_by = any($1::uuid[])", emp_ids)
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
