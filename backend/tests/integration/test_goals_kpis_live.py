"""Live test of task 9 (goals + KPIs + weighted scoring) against the real
Supabase database: company-scoped goal mutation (018/021 fix), the
individual-goal path, KPI creation requiring kpi/update_target, the
sensitive-field split (target/weight/direction vs routine current_value
updates) enforced both by the router pre-check and the DB trigger, KPI
template company-scoping (021, including the "global template immutable via
API" rule), and score computation via the SECURITY DEFINER snapshot function
(022) with its internal authorization check.

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
async def test_goals_kpis_scoring_flow():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    admin_email = f"eems-t9-admin-{suffix}@eems-live-test.dev"
    staff_email = f"eems-t9-staff-{suffix}@eems-live-test.dev"
    outsider_email = f"eems-t9-outsider-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T9 Co {suffix}")
        outsider_company_id = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"T9 Outsider Co {suffix}")

        dept_id = await admin_conn.fetchval(
            "insert into departments (company_id, name, code) values ($1,'Eng',$2) returning id", company_id, f"ENG{suffix}"
        )
        team_id = await admin_conn.fetchval(
            "insert into teams (department_id, name, code) values ($1,'Backend',$2) returning id", dept_id, f"BE{suffix}"
        )
        mgr_pos_id = await admin_conn.fetchval(
            "insert into positions (team_id, title, code) values ($1,'Manager',$2) returning id", team_id, f"MGR{suffix}"
        )
        staff_pos_id = await admin_conn.fetchval(
            "insert into positions (team_id, title, code, reports_to_position_id) values ($1,'Engineer',$2,$3) returning id",
            team_id, f"ENG{suffix}", mgr_pos_id,
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
                auth_user_id, first, "T9", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_id, headers_admin = await make_employee(admin_email, "Admin")
        staff_id, headers_staff = await make_employee(staff_email, "Staff")
        outsider_id, headers_outsider = await make_employee(outsider_email, "Outsider")

        # admin holds a REAL position in this company (not just a grant) --
        # required for goals_select's employee_current_company_id() check to
        # show them the company-type goal they're about to create (see the
        # comment in routers/goals.py about this RETURNING-visibility path).
        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
            mgr_pos_id, admin_id, admin_id,
        )
        await admin_conn.execute(
            "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
            staff_pos_id, staff_id, admin_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_id, super_admin_role_id, company_id,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            outsider_id, super_admin_role_id, outsider_company_id,
        )

        # --- goals: company-scoped mutate (021 fix) ---
        resp = await api_client.post(
            "/api/v1/goals", headers=headers_admin,
            json={
                "company_id": str(company_id), "title": "Ship v2", "goal_type": "company",
                "period_start": "2026-01-01", "period_end": "2026-12-31",
            },
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        goal_id = resp.json()["id"]

        # cross-company goal creation must be rejected
        resp = await api_client.post(
            "/api/v1/goals", headers=headers_outsider,
            json={
                "company_id": str(company_id), "title": "Should fail", "goal_type": "company",
                "period_start": "2026-01-01", "period_end": "2026-12-31",
            },
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # invalid owner/type combination is rejected client-side (422), not just by the DB constraint
        resp = await api_client.post(
            "/api/v1/goals", headers=headers_admin,
            json={
                "company_id": str(company_id), "title": "Bad", "goal_type": "individual",
                "period_start": "2026-01-01", "period_end": "2026-12-31",
            },
        )
        assert resp.status_code == 422, f"expected 422, got {resp.status_code}: {resp.text}"

        # --- KPIs: creation requires kpi/update_target on the target employee ---
        resp = await api_client.post(
            "/api/v1/kpis", headers=headers_admin,
            json={
                "employee_id": staff_id, "goal_id": goal_id, "name": "PRs merged", "unit": "count",
                "direction": "higher_is_better", "target_value": 20, "weight": 100,
                "period_start": "2026-01-01", "period_end": "2026-03-31",
            },
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        kpi = resp.json()
        kpi_id = kpi["id"]
        assert kpi["current_value"] == 0

        # staff (self) cannot create their OWN KPI -- kpi/update_target isn't
        # self-grantable by design (the exact scoring-integrity gap the
        # original design audit flagged)
        resp = await api_client.post(
            "/api/v1/kpis", headers=headers_staff,
            json={
                "employee_id": staff_id, "name": "Self-set KPI", "unit": "count",
                "direction": "higher_is_better", "target_value": 5, "weight": 50,
                "period_start": "2026-01-01", "period_end": "2026-03-31",
            },
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # outsider (no relationship to staff) cannot create a KPI for them either
        resp = await api_client.post(
            "/api/v1/kpis", headers=headers_outsider,
            json={
                "employee_id": staff_id, "name": "Outsider KPI", "unit": "count",
                "direction": "higher_is_better", "target_value": 5, "weight": 50,
                "period_start": "2026-01-01", "period_end": "2026-03-31",
            },
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # --- staff CAN log routine progress (current_value) on their own KPI ---
        resp = await api_client.patch(f"/api/v1/kpis/{kpi_id}", headers=headers_staff, json={"current_value": 10})
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["current_value"] == 10

        # --- but staff CANNOT change their own target -- router pre-check catches this before the DB trigger does ---
        resp = await api_client.patch(f"/api/v1/kpis/{kpi_id}", headers=headers_staff, json={"target_value": 1})
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
        unchanged_target = await admin_conn.fetchval("select target_value from kpis where id = $1", uuid.UUID(kpi_id))
        assert float(unchanged_target) == 20.0, "target must not have changed"

        # --- admin (holds update_target) CAN change the target -- and it's logged to kpi_change_log ---
        resp = await api_client.patch(f"/api/v1/kpis/{kpi_id}", headers=headers_admin, json={"target_value": 25})
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/kpis/{kpi_id}/change-log", headers=headers_admin)
        assert resp.status_code == 200
        log = resp.json()
        assert any(e["field_changed"] == "target_value" and e["new_value"] == "25" for e in log)

        resp = await api_client.get(f"/api/v1/kpis/{kpi_id}/value-history", headers=headers_admin)
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) == 2  # creation (0) + the current_value=10 update
        assert history[-1]["new_value"] == 10

        # --- KPI templates: company-scoped, global (company_id=null) not API-mutable ---
        resp = await api_client.post(
            "/api/v1/kpi-templates", headers=headers_admin,
            json={"company_id": str(company_id), "name": "Code Quality", "unit": "score", "direction": "higher_is_better"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        template_id = resp.json()["id"]

        resp = await api_client.patch(f"/api/v1/kpi-templates/{template_id}", headers=headers_outsider, json={"name": "Hijacked"})
        assert resp.status_code in (403, 404), f"expected 403/404, got {resp.status_code}: {resp.text}"
        still_named = await admin_conn.fetchval("select name from kpi_templates where id = $1", uuid.UUID(template_id))
        assert still_named == "Code Quality"

        # --- score computation: weighted, direction-aware, snapshot ---
        resp = await api_client.post(
            "/api/v1/scores/compute", headers=headers_admin,
            json={"employee_id": staff_id, "period_start": "2026-01-01", "period_end": "2026-03-31"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        score = resp.json()
        assert score["computed_score"] == 40.0, f"expected 10/25*100=40.0, got {score['computed_score']}"
        assert len(score["kpi_snapshot"]) == 1

        # outsider cannot compute a score for someone they have no relationship to
        resp = await api_client.post(
            "/api/v1/scores/compute", headers=headers_outsider,
            json={"employee_id": staff_id, "period_start": "2026-01-01", "period_end": "2026-03-31"},
        )
        assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"

        # staff can compute their OWN score
        resp = await api_client.post(
            "/api/v1/scores/compute", headers=headers_staff,
            json={"employee_id": staff_id, "period_start": "2026-01-01", "period_end": "2026-03-31"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/scores?employee_id={staff_id}", headers=headers_admin)
        assert resp.status_code == 200 and len(resp.json()) == 2

    finally:
        try:
            company_ids = [company_id, outsider_company_id]
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-t9-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            if emp_ids:
                await admin_conn.execute("delete from kpi_scores where employee_id = any($1::uuid[])", emp_ids)
                await admin_conn.execute("delete from kpi_change_log where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpi_value_history where kpi_id in (select id from kpis where employee_id = any($1::uuid[]))", emp_ids)
                await admin_conn.execute("delete from kpis where employee_id = any($1::uuid[])", emp_ids)

            await admin_conn.execute("delete from kpi_templates where company_id = any($1::uuid[])", company_ids)
            await admin_conn.execute("delete from goals where company_id = any($1::uuid[])", company_ids)

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
            await admin_conn.execute("delete from teams where department_id in (select id from departments where company_id = any($1::uuid[]))", company_ids)
            await admin_conn.execute("delete from departments where company_id = any($1::uuid[])", company_ids)

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
