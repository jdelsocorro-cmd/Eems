-- ============================================================================
-- 013_scope_aware_org_structure_mutate.sql
--
-- Real security bug found via integration testing, not a test artifact:
-- companies_mutate / departments_mutate / teams_mutate / positions_mutate
-- (006_rls_policies.sql) used `for all using (app.has_permission(employee_id,
-- 'org_structure', 'manage'))` -- has_permission() only checks whether the
-- employee holds the permission AT ALL, not whether it's scoped to the
-- company/row in question. Since RLS's "for all" applies its USING clause
-- to SELECT too (needed to determine which rows a mutation can target), and
-- permissive policies OR together with the dedicated *_select policies,
-- this silently granted blanket, company-wide SELECT visibility on
-- companies/departments/teams/positions to anyone holding org_structure.
-- manage at ANY scope -- completely bypassing the company-scoped
-- visibility that employee_accessible_company_ids() (011) was built to
-- enforce. A Super Admin scoped to Company A could see (and, worse, WRITE)
-- Company B's org structure.
--
-- Confirmed the gap existed specifically because position_closure has no
-- equivalent mutate policy (it's system-managed, no client mutate policy
-- at all) -- its visibility correctly stayed company-scoped while
-- positions' own visibility leaked, producing a visible-position-but-
-- invisible-closure-row inconsistency that's what actually surfaced this
-- during testing.
--
-- Fix: mutate policies now require the permission to be scoped to the
-- specific company via employee_accessible_company_ids(), not just held
-- somewhere. This is the correct general pattern for any company-scoped
-- resource -- the same fix will be needed for kpi_templates/goals (built in
-- a later task) when their own mutate policies are written or revisited.
-- ============================================================================

create or replace function app.has_permission_on_company(
  p_employee_id uuid,
  p_company_id uuid,
  p_resource text,
  p_action text
)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select
    app.has_permission(p_employee_id, p_resource, p_action)
    and p_company_id in (select app.employee_accessible_company_ids(p_employee_id));
$$;

-- companies is the top of the hierarchy -- unlike departments/teams/
-- positions, which always nest under an EXISTING company the actor must
-- already be scoped to, a brand new company has no parent to scope its
-- creation against.
--
-- Found the hard way via testing: Postgres enforces a FOR ALL policy's
-- USING clause on INSERT too whenever RETURNING is used (needed to confirm
-- the caller can "see" the row being handed back) -- not just WITH CHECK,
-- which is all that's commonly documented. So it's not enough for WITH
-- CHECK to allow creating a company with the plain, unscoped permission;
-- USING must also pass for the newly-created row to come back, and
-- has_permission_on_company() can never pass for a row whose id doesn't
-- exist in anyone's grants yet -- a genuine chicken-and-egg problem, not
-- something a smarter USING expression can route around.
--
-- Fix: the actual pattern real multi-tenant systems use anyway -- whoever
-- creates a company automatically becomes its admin, via the trigger below.
-- That grant exists (and is visible to USING) by the time RETURNING needs
-- it, and "company creator becomes company admin" is the correct default
-- regardless of the RLS mechanics that surfaced the need for it.
drop policy companies_mutate on companies;
create policy companies_mutate on companies for all
  using (app.has_permission_on_company(app.current_employee_id(), id, 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

create or replace function app.grant_company_creator_admin()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_creator_id uuid := app.current_employee_id();
  v_super_admin_role_id uuid;
begin
  -- Null creator = a system/service-role path creating a company outside
  -- any employee's session (e.g. a future admin script) -- nothing to grant.
  if v_creator_id is null then
    return new;
  end if;

  select id into v_super_admin_role_id from roles where name = 'Super Admin' and is_system limit 1;

  insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by)
  values (v_creator_id, v_super_admin_role_id, 'company', new.id, v_creator_id);

  return new;
end;
$$;

-- BEFORE, not AFTER: Postgres evaluates the RETURNING-visibility (USING)
-- check as part of processing the INSERT itself -- an AFTER trigger's
-- employee_roles side effect wasn't visible to that check yet (confirmed by
-- testing: the same trigger AFTER INSERT worked when RETURNING wasn't used,
-- but failed with it). A BEFORE trigger's insert into employee_roles
-- commits before the companies row is written, so it's already in place by
-- the time RETURNING needs it. NEW.id is available even in a BEFORE
-- trigger -- either the client supplied it explicitly (SQLAlchemy generates
-- it client-side) or Postgres applies the column default before BEFORE
-- triggers run either way.
drop trigger if exists trg_companies_grant_creator_admin on companies;
create trigger trg_companies_grant_creator_admin
  before insert on companies
  for each row execute function app.grant_company_creator_admin();

drop policy departments_mutate on departments;
create policy departments_mutate on departments for all
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'));

drop policy teams_mutate on teams;
create policy teams_mutate on teams for all
  using (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from departments where id = teams.department_id),
      'org_structure', 'manage'
    )
  )
  with check (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from departments where id = teams.department_id),
      'org_structure', 'manage'
    )
  );

-- Both USING (checked against the existing row for UPDATE/DELETE) and WITH
-- CHECK (checked against the new/incoming row for INSERT/UPDATE) resolve
-- the company via the row's own team_id column directly -- simpler and
-- more direct than looking the row back up through app.position_company_id().
drop policy positions_mutate on positions;
create policy positions_mutate on positions for all
  using (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select d.company_id from teams t join departments d on d.id = t.department_id where t.id = positions.team_id),
      'org_structure', 'manage'
    )
  )
  with check (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select d.company_id from teams t join departments d on d.id = t.department_id where t.id = positions.team_id),
      'org_structure', 'manage'
    )
  );
