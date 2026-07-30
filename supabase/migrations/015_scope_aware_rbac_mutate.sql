-- ============================================================================
-- 015_scope_aware_rbac_mutate.sql
--
-- Same class of bug as 013 (companies/departments/teams/positions), found
-- proactively this time while building the RBAC admin endpoints rather than
-- via live testing: roles_mutate / role_permissions_mutate /
-- employee_roles_mutate (006_rls_policies.sql) all used the scope-blind
-- has_permission(employee_id, 'role', 'manage') check in a `for all`
-- policy -- anyone holding role.manage ANYWHERE could create/edit roles,
-- grant permissions to roles, and grant role assignments to employees for
-- ANY company, not just the one(s) they're actually scoped to.
--
-- Fix, same pattern as 013:
--   - roles: company_id is not null (system templates are seed-only, never
--     API-mutable) AND has_permission_on_company() for that company.
--   - role_permissions: resolved via the parent role's company_id.
--   - employee_roles: resolved via the grant's own scope_type/scope_id,
--     using the new app.scope_company_id() helper -- except 'self' scope,
--     which stays a plain has_permission() check since it's inherently
--     narrow (only ever affects the named employee's own self-visibility,
--     which every employee already has unconditionally regardless of any
--     grant -- there's nothing to leak).
-- ============================================================================

create or replace function app.scope_company_id(p_scope_type rbac_scope_type, p_scope_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select case p_scope_type
    when 'company' then p_scope_id
    when 'department' then (select company_id from departments where id = p_scope_id)
    when 'team' then (select d.company_id from teams t join departments d on d.id = t.department_id where t.id = p_scope_id)
    when 'position_subtree' then app.position_company_id(p_scope_id)
    else null
  end;
$$;

drop policy roles_mutate on roles;
create policy roles_mutate on roles for all
  using (company_id is not null and app.has_permission_on_company(app.current_employee_id(), company_id, 'role', 'manage'))
  with check (company_id is not null and app.has_permission_on_company(app.current_employee_id(), company_id, 'role', 'manage'));

drop policy role_permissions_mutate on role_permissions;
create policy role_permissions_mutate on role_permissions for all
  using (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.company_id is not null
        and app.has_permission_on_company(app.current_employee_id(), r.company_id, 'role', 'manage')
    )
  )
  with check (
    exists (
      select 1 from roles r
      where r.id = role_permissions.role_id
        and r.company_id is not null
        and app.has_permission_on_company(app.current_employee_id(), r.company_id, 'role', 'manage')
    )
  );

drop policy employee_roles_mutate on employee_roles;
create policy employee_roles_mutate on employee_roles for all
  using (
    (scope_type = 'self' and app.has_permission(app.current_employee_id(), 'role', 'manage'))
    or (scope_type <> 'self' and app.has_permission_on_company(app.current_employee_id(), app.scope_company_id(scope_type, scope_id), 'role', 'manage'))
  )
  with check (
    (scope_type = 'self' and app.has_permission(app.current_employee_id(), 'role', 'manage'))
    or (scope_type <> 'self' and app.has_permission_on_company(app.current_employee_id(), app.scope_company_id(scope_type, scope_id), 'role', 'manage'))
  );
