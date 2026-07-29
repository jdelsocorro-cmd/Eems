-- ============================================================================
-- 011_org_structure_visibility_via_grants.sql
--
-- Bug found via integration testing: companies/departments/teams/positions/
-- position_closure SELECT policies (006_rls_policies.sql) used
-- app.employee_current_company_id(), which only resolves via an ACTIVE
-- position_assignments row. But someone can legitimately hold a
-- company-scoped permission grant (employee_roles) -- e.g. the very first
-- Super Admin, per the bootstrap flow documented in supabase/seed.sql --
-- before they're ever assigned an org-chart seat. Under the old policy,
-- that admin couldn't see the company/departments/teams/positions they had
-- just been granted rights to manage: employee_current_company_id()
-- returned null, so `company_id = null` matched nothing.
--
-- Fix: visibility is now "employed within this company" OR "holds any
-- company-scoped grant naming this company" -- administrative access via
-- permission, not just organizational membership via a seat.
-- ============================================================================

create or replace function app.employee_accessible_company_ids(p_employee_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select app.employee_current_company_id(p_employee_id)
  where app.employee_current_company_id(p_employee_id) is not null

  union

  select scope_id
  from employee_roles
  where employee_id = p_employee_id
    and scope_type = 'company'
    and (expires_at is null or expires_at > now());
$$;

drop policy companies_select on companies;
create policy companies_select on companies for select
  using (id in (select app.employee_accessible_company_ids(app.current_employee_id())));

drop policy departments_select on departments;
create policy departments_select on departments for select
  using (company_id in (select app.employee_accessible_company_ids(app.current_employee_id())));

drop policy teams_select on teams;
create policy teams_select on teams for select
  using (
    department_id in (
      select id from departments
      where company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

drop policy positions_select on positions;
create policy positions_select on positions for select
  using (
    team_id in (
      select t.id from teams t
      join departments d on d.id = t.department_id
      where d.company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

drop policy position_closure_select on position_closure;
create policy position_closure_select on position_closure for select
  using (
    ancestor_position_id in (
      select p.id from positions p
      join teams t on t.id = p.team_id
      join departments d on d.id = t.department_id
      where d.company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

drop policy position_hierarchy_history_select on position_hierarchy_history;
create policy position_hierarchy_history_select on position_hierarchy_history for select
  using (
    position_id in (
      select id from positions where team_id in (
        select t.id from teams t
        join departments d on d.id = t.department_id
        where d.company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
      )
    )
  );

drop policy kpi_templates_select on kpi_templates;
create policy kpi_templates_select on kpi_templates for select
  using (
    company_id is null
    or company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
  );

drop policy goals_select on goals;
create policy goals_select on goals for select
  using (
    (goal_type in ('company', 'department', 'team')
      and company_id in (select app.employee_accessible_company_ids(app.current_employee_id())))
    or (goal_type = 'individual'
      and (employee_id = app.current_employee_id()
           or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))))
  );
