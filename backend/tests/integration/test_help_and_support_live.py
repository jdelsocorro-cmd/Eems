"""Live test of Phase 3 (Help Center + Support Tickets) against the real
Supabase database: draft articles invisible to non-authors, publishing makes
them visible + searchable, role-restricted articles invisible until the
role is held, version history snapshots prior edits, and -- the critical
regression case for both features -- a caller who holds the relevant
`manage`/`review` permission via a DIFFERENT company still gets blocked by
RLS's company scoping (RETURNING-then-check), not just a bare permission
check.

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
async def test_help_center_and_support_tickets():
    admin_conn = await asyncpg.connect(_admin_db_url(), statement_cache_size=0)
    auth_client = httpx.AsyncClient()
    api_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    suffix = uuid.uuid4().hex[:8]
    admin_a_email = f"eems-p3-admina-{suffix}@eems-live-test.dev"
    emp_a_email = f"eems-p3-empa-{suffix}@eems-live-test.dev"
    admin_b_email = f"eems-p3-adminb-{suffix}@eems-live-test.dev"
    created_auth_user_ids = []

    try:
        super_admin_role_id = await admin_conn.fetchval("select id from roles where name = 'Super Admin'")
        manager_role_id = await admin_conn.fetchval("select id from roles where name = 'Manager'")

        company_a = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"P3 Co A {suffix}")
        company_b = await admin_conn.fetchval("insert into companies (name) values ($1) returning id", f"P3 Co B {suffix}")

        unit_a = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_a
        )
        unit_b = await admin_conn.fetchval(
            "insert into org_units (company_id, name, unit_type) values ($1,'Ops','department') returning id", company_b
        )
        pos_a = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Lead',$2) returning id", unit_a, f"LEADA{suffix}"
        )
        pos_a2 = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Staff',$2) returning id", unit_a, f"STFA{suffix}"
        )
        pos_b = await admin_conn.fetchval(
            "insert into positions (org_unit_id, title, code) values ($1,'Lead',$2) returning id", unit_b, f"LEADB{suffix}"
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
                auth_user_id, first, "P3", email,
            )
            resp = await auth_client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                json={"email": email, "password": PASSWORD},
            )
            resp.raise_for_status()
            return str(employee_id), {"Authorization": f"Bearer {resp.json()['access_token']}"}

        admin_a_id, headers_admin_a = await make_employee(admin_a_email, "AdminA")
        emp_a_id, headers_emp_a = await make_employee(emp_a_email, "EmpA")
        admin_b_id, headers_admin_b = await make_employee(admin_b_email, "AdminB")

        for pos_id, emp_id in ((pos_a, admin_a_id), (pos_a2, emp_a_id), (pos_b, admin_b_id)):
            await admin_conn.execute(
                "insert into position_assignments (position_id, employee_id, created_by) values ($1,$2,$3)",
                pos_id, emp_id, emp_id,
            )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_a_id, super_admin_role_id, company_a,
        )
        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by) values ($1,$2,'company',$3,$1)",
            admin_b_id, super_admin_role_id, company_b,
        )

        # ============================================================
        # Help Center
        # ============================================================

        resp = await api_client.post(
            "/api/v1/help/categories", headers=headers_admin_a, json={"company_id": str(company_a), "name": f"SOPs {suffix}"}
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        category_id = resp.json()["id"]

        resp = await api_client.post(
            "/api/v1/help/articles", headers=headers_admin_a,
            json={
                "company_id": str(company_a), "category_id": category_id,
                "title": f"How to submit a task {suffix}", "body_markdown": "Click submit for review on the task page.",
                "tags": ["tasks", "onboarding"],
            },
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        article = resp.json()
        article_id = article["id"]
        assert article["status"] == "draft"

        # draft is invisible to an ordinary employee, even one in the same company
        resp = await api_client.get(f"/api/v1/help/articles/{article_id}", headers=headers_emp_a)
        assert resp.status_code == 404, f"draft should be invisible to non-authors, got {resp.status_code}: {resp.text}"

        # publish it
        resp = await api_client.patch(f"/api/v1/help/articles/{article_id}", headers=headers_admin_a, json={"status": "published"})
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"
        assert resp.json()["status"] == "published"

        # now visible to the ordinary employee
        resp = await api_client.get(f"/api/v1/help/articles/{article_id}", headers=headers_emp_a)
        assert resp.status_code == 200, f"published article should be visible, got {resp.status_code}: {resp.text}"

        # and findable via search
        resp = await api_client.get(f"/api/v1/help/articles?q=submit+a+task", headers=headers_emp_a)
        assert resp.status_code == 200
        assert any(a["id"] == article_id for a in resp.json()), "search should find the published article by title text"

        # editing the title generates a version snapshot of the PRIOR title
        resp = await api_client.patch(
            f"/api/v1/help/articles/{article_id}", headers=headers_admin_a, json={"title": f"How to submit work {suffix}"}
        )
        assert resp.status_code == 200
        resp = await api_client.get(f"/api/v1/help/articles/{article_id}/versions", headers=headers_admin_a)
        assert resp.status_code == 200
        versions = resp.json()
        assert len(versions) == 1 and versions[0]["title"] == f"How to submit a task {suffix}", \
            f"expected one prior version with the old title, got {versions}"

        # a Super Admin of a DIFFERENT company holds help_articles.manage (passes the
        # bare permission dependency) but is not scoped to company_a -- RLS must still
        # block the edit (RETURNING-then-check), not just the coarse permission check
        resp = await api_client.patch(
            f"/api/v1/help/articles/{article_id}", headers=headers_admin_b, json={"title": "hijacked"}
        )
        assert resp.status_code == 404, f"cross-company admin must be blocked by RLS, got {resp.status_code}: {resp.text}"

        # role-restricted article: only visible to Manager-role holders
        resp = await api_client.post(
            "/api/v1/help/articles", headers=headers_admin_a,
            json={
                "company_id": str(company_a), "title": f"Manager-only SOP {suffix}",
                "body_markdown": "Confidential process notes.", "status": "published",
            },
        )
        assert resp.status_code == 201
        restricted_id = resp.json()["id"]
        resp = await api_client.post(f"/api/v1/help/articles/{restricted_id}/roles/{manager_role_id}", headers=headers_admin_a, json={})
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/help/articles/{restricted_id}", headers=headers_emp_a)
        assert resp.status_code == 404, f"published but role-restricted article should stay invisible, got {resp.status_code}"

        await admin_conn.execute(
            "insert into employee_roles (employee_id, role_id, scope_type, granted_by) values ($1,$2,'self',$1)",
            emp_a_id, manager_role_id,
        )
        resp = await api_client.get(f"/api/v1/help/articles/{restricted_id}", headers=headers_emp_a)
        assert resp.status_code == 200, f"holding the listed role should reveal it, got {resp.status_code}: {resp.text}"

        # ============================================================
        # Support Tickets
        # ============================================================

        resp = await api_client.post(
            "/api/v1/support-tickets", headers=headers_emp_a,
            json={"title": f"Button broken {suffix}", "description": "The submit button does nothing.", "severity": "high", "category": "bug"},
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"
        ticket = resp.json()
        ticket_id = ticket["id"]
        assert ticket["status"] == "new" and ticket["reported_by"] == emp_a_id

        # reporter can see their own ticket
        resp = await api_client.get("/api/v1/support-tickets", headers=headers_emp_a)
        assert resp.status_code == 200 and any(t["id"] == ticket_id for t in resp.json())

        # a Super Admin of a different company cannot see it at all
        resp = await api_client.get("/api/v1/support-tickets", headers=headers_admin_b)
        assert resp.status_code == 200 and not any(t["id"] == ticket_id for t in resp.json()), \
            "cross-company admin must not see another company's tickets"

        # the reporter (holds no support_tickets.review grant at all) cannot change its status
        resp = await api_client.patch(f"/api/v1/support-tickets/{ticket_id}", headers=headers_emp_a, json={"status": "acknowledged"})
        assert resp.status_code == 403, f"reporter without review permission should be 403'd, got {resp.status_code}: {resp.text}"

        # a Super Admin of a DIFFERENT company holds support_tickets.review (passes the
        # bare permission dependency) but RLS must still block them -- same
        # RETURNING-then-check regression this whole file is built to catch
        resp = await api_client.patch(f"/api/v1/support-tickets/{ticket_id}", headers=headers_admin_b, json={"status": "closed"})
        assert resp.status_code == 404, f"cross-company admin must be blocked by RLS, got {resp.status_code}: {resp.text}"

        # the real reviewer (Super Admin of the SAME company) can
        resp = await api_client.patch(f"/api/v1/support-tickets/{ticket_id}", headers=headers_admin_a, json={"status": "acknowledged"})
        assert resp.status_code == 200 and resp.json()["status"] == "acknowledged", f"expected 200, got {resp.status_code}: {resp.text}"

        # internal notes: reporter cannot read them, reviewer can add + read
        resp = await api_client.get(f"/api/v1/support-tickets/{ticket_id}/notes", headers=headers_emp_a)
        assert resp.status_code == 403, f"reporter should not access internal notes, got {resp.status_code}: {resp.text}"

        resp = await api_client.post(
            f"/api/v1/support-tickets/{ticket_id}/notes", headers=headers_admin_a, json={"note": "Reproduced on staging."}
        )
        assert resp.status_code == 201, f"expected 201, got {resp.status_code}: {resp.text}"

        resp = await api_client.get(f"/api/v1/support-tickets/{ticket_id}/notes", headers=headers_admin_a)
        assert resp.status_code == 200 and len(resp.json()) == 1

    finally:
        try:
            company_ids = [company_a, company_b]
            emp_ids = await admin_conn.fetch("select id from employees where work_email like $1", f"%eems-p3-%{suffix}%")
            emp_ids = [r["id"] for r in emp_ids]

            article_ids = await admin_conn.fetch("select id from help_articles where company_id = any($1::uuid[])", company_ids)
            article_ids = [r["id"] for r in article_ids]
            if article_ids:
                await admin_conn.execute("delete from help_article_versions where article_id = any($1::uuid[])", article_ids)
                await admin_conn.execute("delete from help_article_roles where article_id = any($1::uuid[])", article_ids)
                await admin_conn.execute("delete from help_articles where id = any($1::uuid[])", article_ids)
            await admin_conn.execute("delete from help_categories where company_id = any($1::uuid[])", company_ids)

            ticket_ids = await admin_conn.fetch("select id from support_tickets where company_id = any($1::uuid[])", company_ids)
            ticket_ids = [r["id"] for r in ticket_ids]
            if ticket_ids:
                await admin_conn.execute("delete from support_ticket_notes where ticket_id = any($1::uuid[])", ticket_ids)
                await admin_conn.execute("delete from support_tickets where id = any($1::uuid[])", ticket_ids)

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
