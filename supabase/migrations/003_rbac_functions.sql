-- ============================================================================
-- 003_rbac_functions.sql
-- The RBAC mechanism itself: accessible_position_ids / accessible_employee_ids
-- / has_permission. These are the single source of truth called from BOTH
-- RLS policies (006) and FastAPI's Depends(require_permission(...)) -- one
-- definition of "what can this employee see/do", enforced twice.
-- ============================================================================

-- app.accessible_position_ids(employee_id)
-- Unions, across that employee's non-expired employee_roles grants, every
-- position within the granted scope. position_subtree scope uses
-- position_closure so this is an indexed lookup, not a recursive walk.
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
  -- company scope: every position under every department/team in the company
  select p.id
  from grants g
  join departments d on d.company_id = g.scope_id
  join teams t on t.department_id = d.id
  join positions p on p.team_id = t.id
  where g.scope_type = 'company'
    and p.deleted_at is null

  union

  -- department scope: every position under every team in the department
  select p.id
  from grants g
  join teams t on t.department_id = g.scope_id
  join positions p on p.team_id = t.id
  where g.scope_type = 'department'
    and p.deleted_at is null

  union

  -- team scope: every position on the team
  select p.id
  from grants g
  join positions p on p.team_id = g.scope_id
  where g.scope_type = 'team'
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

-- app.accessible_employee_ids(employee_id)
-- Employees whose CURRENT position_assignments row falls in an accessible
-- position, plus the employee themself always (self-visibility should never
-- depend on having a role grant).
create or replace function app.accessible_employee_ids(p_employee_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select p_employee_id

  union

  select pa.employee_id
  from position_assignments pa
  where pa.end_date is null
    and pa.is_primary
    and pa.position_id in (select app.accessible_position_ids(p_employee_id));
$$;

-- app.has_permission(employee_id, resource, action)
-- Pure grant check -- does this employee hold ANY role (at any scope) with
-- this permission. Used where the question is "can they do X at all", not
-- "which records can they see" (that's accessible_employee_ids/RLS).
create or replace function app.has_permission(p_employee_id uuid, p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
    from employee_roles er
    join role_permissions rp on rp.role_id = er.role_id
    join permissions perm on perm.id = rp.permission_id
    where er.employee_id = p_employee_id
      and (er.expires_at is null or er.expires_at > now())
      and perm.resource = p_resource
      and perm.action = p_action
  );
$$;

-- app.has_permission_on_employee(employee_id, target_employee_id, resource, action)
-- Convenience wrapper for the common "can I do X to a specific person"
-- check, combining the permission grant with subtree scope in one call so
-- routers don't have to compose accessible_employee_ids + has_permission by
-- hand every time.
create or replace function app.has_permission_on_employee(
  p_employee_id uuid,
  p_target_employee_id uuid,
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
    and (
      p_employee_id = p_target_employee_id
      or p_target_employee_id in (select app.accessible_employee_ids(p_employee_id))
    );
$$;
