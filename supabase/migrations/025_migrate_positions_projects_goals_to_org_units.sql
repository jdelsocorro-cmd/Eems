-- ============================================================================
-- 025_migrate_positions_projects_goals_to_org_units.sql
--
-- Repoints positions/projects/goals from the fixed department/team columns
-- onto org_units (024), then retires the departments/teams tables. Safe to
-- do as a hard cutover, not an additive/backfill migration -- confirmed via
-- direct query that no departments/teams/positions/projects/goals rows
-- exist yet in the live database (only the company, the first admin
-- employee, and their company-scoped Super Admin grant), so there is
-- nothing to migrate data-wise, only schema and the functions/policies that
-- depend on it.
--
-- Ordering note: every ALTER COLUMN TYPE / DROP COLUMN below is preceded by
-- dropping whatever policy or function references that column/type first --
-- Postgres refuses the alteration otherwise (DependentObjectsStillExistError),
-- the same class of error hit and fixed live while first applying this
-- migration (positions_select/positions_mutate referenced team_id directly).
-- Each dropped policy/function is recreated further down once its
-- dependency has moved to org_units.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- positions: team_id -> org_unit_id
-- ----------------------------------------------------------------------------
drop policy positions_select on positions;
drop policy positions_mutate on positions;

alter table positions add column org_unit_id uuid references org_units(id);
alter table positions drop column team_id;
alter table positions alter column org_unit_id set not null;
alter table positions add constraint uq_positions_org_unit_code unique (org_unit_id, code);
create index idx_positions_org_unit on positions(org_unit_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- projects: department_id + team_id -> single org_unit_id
-- ----------------------------------------------------------------------------
alter table projects add column org_unit_id uuid references org_units(id);
alter table projects drop column department_id;
alter table projects drop column team_id;
create index idx_projects_org_unit on projects(org_unit_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- goals: goal_type collapses from ('company','department','team','individual')
-- to ('company','org_unit','individual') -- department vs. team was never a
-- meaningful distinction for goal ownership, just a byproduct of the fixed
-- schema; org_units.unit_type carries that label now if it's ever needed for
-- display. goals_select (references goal_type) must be dropped before the
-- column's type changes.
-- ----------------------------------------------------------------------------
drop policy goals_select on goals;
alter table goals drop constraint chk_goals_owner_matches_type;
alter table goals add column org_unit_id uuid references org_units(id);

alter type goal_type rename to goal_type_old;
create type goal_type as enum ('company', 'org_unit', 'individual');
alter table goals alter column goal_type type goal_type using (
  case goal_type::text when 'department' then 'org_unit' when 'team' then 'org_unit' else goal_type::text end
)::goal_type;
drop type goal_type_old;

alter table goals drop column department_id;
alter table goals drop column team_id;

alter table goals add constraint chk_goals_owner_matches_type check (
  (goal_type = 'company'    and org_unit_id is null and employee_id is null) or
  (goal_type = 'org_unit'   and org_unit_id is not null and employee_id is null) or
  (goal_type = 'individual' and org_unit_id is null and employee_id is not null)
);

create policy goals_select on goals for select
  using (
    (goal_type in ('company', 'org_unit')
      and company_id in (select app.employee_accessible_company_ids(app.current_employee_id())))
    or (goal_type = 'individual'
      and (employee_id = app.current_employee_id()
           or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))))
  );

-- ----------------------------------------------------------------------------
-- employee_roles.scope_type: 'department'/'team' collapse to 'org_unit'.
-- Recreated (not ALTER TYPE ADD VALUE) since nothing needs to stay -- no
-- employee_roles row currently uses 'department' or 'team' (confirmed: the
-- only grant in the live DB is the bootstrap Super Admin, scope_type
-- 'company'), so there's no legacy data this cast could silently mishandle.
--
-- employee_roles_mutate references scope_type directly, and
-- app.scope_company_id()'s parameter type IS rbac_scope_type -- both must
-- be dropped before the type rename, not just before the column alter.
-- chk_employee_roles_scope_id (002_rbac.sql) also references scope_type in
-- its check expression, same requirement.
-- ----------------------------------------------------------------------------
drop policy employee_roles_mutate on employee_roles;
drop function app.scope_company_id(rbac_scope_type, uuid);
alter table employee_roles drop constraint chk_employee_roles_scope_id;

alter type rbac_scope_type rename to rbac_scope_type_old;
create type rbac_scope_type as enum ('company', 'org_unit', 'position_subtree', 'self');
alter table employee_roles alter column scope_type type rbac_scope_type using scope_type::text::rbac_scope_type;
drop type rbac_scope_type_old;

alter table employee_roles add constraint chk_employee_roles_scope_id check (
  (scope_type = 'self' and scope_id is null)
  or (scope_type <> 'self' and scope_id is not null)
);

-- app.scope_company_id(): 'department'/'team' branches collapse into one
-- 'org_unit' branch, resolved directly off org_units.company_id.
create or replace function app.scope_company_id(p_scope_type rbac_scope_type, p_scope_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select case p_scope_type
    when 'company' then p_scope_id
    when 'org_unit' then (select company_id from org_units where id = p_scope_id)
    when 'position_subtree' then app.position_company_id(p_scope_id)
    else null
  end;
$$;

create policy employee_roles_mutate on employee_roles for all
  using (
    (scope_type = 'self' and app.has_permission(app.current_employee_id(), 'role', 'manage'))
    or (scope_type <> 'self' and app.has_permission_on_company(app.current_employee_id(), app.scope_company_id(scope_type, scope_id), 'role', 'manage'))
  )
  with check (
    (scope_type = 'self' and app.has_permission(app.current_employee_id(), 'role', 'manage'))
    or (scope_type <> 'self' and app.has_permission_on_company(app.current_employee_id(), app.scope_company_id(scope_type, scope_id), 'role', 'manage'))
  );

-- ----------------------------------------------------------------------------
-- Retire departments/teams. positions/projects/goals no longer reference
-- them (above), so this is a clean drop, not a cascade into anything
-- unexpected.
-- ----------------------------------------------------------------------------
drop table teams;
drop table departments;

-- ----------------------------------------------------------------------------
-- Helper functions: position -> org_unit -> company is a single join now,
-- not a 3-table chain through team and department.
-- ----------------------------------------------------------------------------
create or replace function app.employee_current_company_id(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select ou.company_id
  from position_assignments pa
  join positions p on p.id = pa.position_id
  join org_units ou on ou.id = p.org_unit_id
  where pa.employee_id = p_employee_id
    and pa.end_date is null
    and pa.is_primary
  limit 1;
$$;

create or replace function app.position_company_id(p_position_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select ou.company_id
  from positions p
  join org_units ou on ou.id = p.org_unit_id
  where p.id = p_position_id;
$$;

-- app.accessible_position_ids(): 'department'/'team' scope branches collapse
-- into one 'org_unit' branch using org_unit_closure -- a grant scoped to any
-- unit now covers that unit AND everything nested under it, regardless of
-- depth, instead of two separate fixed-depth branches.
create or replace function app.accessible_position_ids(p_employee_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  with grants as (
    select scope_type, scope_id
    from employee_roles
    where employee_id = p_employee_id
      and (expires_at is null or expires_at > now())
  )
  -- company scope: every position under every org unit in the company
  select p.id
  from grants g
  join org_units ou on ou.company_id = g.scope_id
  join positions p on p.org_unit_id = ou.id
  where g.scope_type = 'company'
    and p.deleted_at is null

  union

  -- org_unit scope: every position under the granted unit and its descendants
  select p.id
  from grants g
  join org_unit_closure ouc on ouc.ancestor_unit_id = g.scope_id
  join positions p on p.org_unit_id = ouc.descendant_unit_id
  where g.scope_type = 'org_unit'
    and p.deleted_at is null

  union

  -- position_subtree scope: the granted position and everything under it
  select pc.descendant_position_id
  from grants g
  join position_closure pc on pc.ancestor_position_id = g.scope_id
  where g.scope_type = 'position_subtree'

  union

  -- self scope: just the employee's own current position
  select pa.position_id
  from grants g
  join position_assignments pa on pa.employee_id = p_employee_id and pa.end_date is null and pa.is_primary
  where g.scope_type = 'self';
$$;

-- app.project_ids_in_scope() (023): 'department'/'team' collapse to
-- 'org_unit', resolved via org_unit_closure so a project attached to a
-- child unit still shows up when viewing a parent unit's dashboard.
create or replace function app.project_ids_in_scope(p_scope_type text, p_scope_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select id from projects
  where deleted_at is null
    and (
      (p_scope_type = 'company' and company_id = p_scope_id)
      or (p_scope_type = 'org_unit' and org_unit_id in (
        select descendant_unit_id from org_unit_closure where ancestor_unit_id = p_scope_id
      ))
    );
$$;

-- ----------------------------------------------------------------------------
-- positions RLS: team_id -> org_unit_id (policies dropped near the top of
-- this file, before the column drop; recreated here). positions_mutate goes
-- from a 3-table join chain (013) to a single join, now that org_units
-- carries company_id directly.
-- ----------------------------------------------------------------------------
create policy positions_select on positions for select
  using (
    org_unit_id in (
      select id from org_units where company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

create policy positions_mutate on positions for all
  using (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from org_units where id = positions.org_unit_id),
      'org_structure', 'manage'
    )
  )
  with check (
    app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from org_units where id = positions.org_unit_id),
      'org_structure', 'manage'
    )
  );
