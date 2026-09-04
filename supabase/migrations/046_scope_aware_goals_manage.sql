-- ============================================================================
-- 046_scope_aware_goals_manage.sql
--
-- goal.manage has been company-wide only since 021_scope_aware_goals_kpi_
-- templates_mutate.sql -- fixed the cross-tenant leak there, but never added
-- the finer-grained scoping kpi.update_value/update_target already have via
-- has_permission_on_employee(). That's a real gap, not just an inconsistency:
-- role 00000000-0000-0000-0001-000000000003 ("Department Head") is seeded
-- with goal.manage (007_seed_permissions.sql) and its own description says
-- "typically granted at department or position_subtree scope" -- but the
-- RLS policy never actually enforced that. A Department Head granted
-- goal.manage scoped to their own org_unit could create, edit, or delete
-- ANY other department's goals in the same company, which defeats the
-- entire point of a per-department goals view (Goals & Performance's
-- department column/filter, added the same day as this migration).
--
-- Fix: branch goals_mutate by goal_type, same idea as kpis_insert/update's
-- existing has_permission_on_employee() pattern --
--   company  goals -> still company-wide goal.manage (unchanged; a
--                      department-scoped grant should not be able to touch
--                      or create company-wide goals)
--   org_unit goals -> goal.manage scoped to that unit or an ancestor of it
--                      (new app.has_permission_on_org_unit())
--   individual goals -> goal.manage scoped to that employee (already-correct
--                      app.has_permission_on_employee(), just not used here
--                      before)
-- ============================================================================

-- app.accessible_org_unit_ids(employee_id)
-- Org units this employee's grants cover for org-unit-targeted permission
-- checks (goal.manage on an org_unit goal, and any future org-unit-scoped
-- permission). Mirrors accessible_position_ids' three grant branches:
--   company scope -> every unit in the company
--   org_unit scope -> the granted unit and everything nested under it
--                      (org_unit_closure, depth-agnostic)
--   position_subtree scope -> every org unit with at least one position in
--                      the granted subtree, so a Division Head granted
--                      position_subtree on their own position gets goal.
--                      manage over every department under them, not just
--                      whichever single unit their own position happens to
--                      sit in
-- self scope contributes nothing here -- "manage goals for my own org unit"
-- isn't a self-scoped kind of grant.
create or replace function app.accessible_org_unit_ids(p_employee_id uuid)
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
  select ou.id
  from grants g
  join org_units ou on ou.company_id = g.scope_id
  where g.scope_type = 'company'

  union

  select ouc.descendant_unit_id
  from grants g
  join org_unit_closure ouc on ouc.ancestor_unit_id = g.scope_id
  where g.scope_type = 'org_unit'

  union

  select distinct p.org_unit_id
  from grants g
  join position_closure pc on pc.ancestor_position_id = g.scope_id
  join positions p on p.id = pc.descendant_position_id
  where g.scope_type = 'position_subtree'
    and p.deleted_at is null;
$$;

-- app.has_permission_on_org_unit(employee_id, org_unit_id, resource, action)
-- Same shape as has_permission_on_employee(): grant held anywhere, and the
-- target org unit falls within that grant's accessible scope.
create or replace function app.has_permission_on_org_unit(
  p_employee_id uuid,
  p_org_unit_id uuid,
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
    and p_org_unit_id in (select app.accessible_org_unit_ids(p_employee_id));
$$;

drop policy goals_mutate on goals;
create policy goals_mutate on goals for all
  using (
    case goal_type
      when 'company' then app.has_permission_on_company(app.current_employee_id(), company_id, 'goal', 'manage')
      when 'org_unit' then app.has_permission_on_org_unit(app.current_employee_id(), org_unit_id, 'goal', 'manage')
      when 'individual' then app.has_permission_on_employee(app.current_employee_id(), employee_id, 'goal', 'manage')
    end
  )
  with check (
    case goal_type
      when 'company' then app.has_permission_on_company(app.current_employee_id(), company_id, 'goal', 'manage')
      when 'org_unit' then app.has_permission_on_org_unit(app.current_employee_id(), org_unit_id, 'goal', 'manage')
      when 'individual' then app.has_permission_on_employee(app.current_employee_id(), employee_id, 'goal', 'manage')
    end
  );
