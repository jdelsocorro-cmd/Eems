-- ============================================================================
-- 051_scope_employee_roles_and_review_delegations_select.sql
--
-- Production readiness review (2026-09-05) found the same unscoped-
-- has_permission() bug already fixed 6 times today (audit_log_select,
-- migration 049, being only the most recent) still present on
-- employee_roles_select (006_rls_policies.sql) and on both
-- review_delegations_select/_revoke (038_review_delegations_and_
-- hierarchy_resolution.sql) -- the latter two were explicitly modeled on
-- employee_roles_select's own shape (038's own comment cites it as
-- precedent), meaning the bug was actively propagating into new code
-- rather than shrinking. Dormant today (this deployment has exactly one
-- company), same as audit_log_select was before 049 -- but a role.manage
-- holder scoped to one company could read every company's role grants
-- (who holds what, at what scope, granted by whom) and read/revoke every
-- company's active review-delegation relationships, the moment a second
-- company or an org_unit-scoped role.manage grant exists.
--
-- employee_roles_mutate (015_scope_aware_rbac_mutate.sql) already solved
-- this exact problem for writes to the same table -- resolving the
-- grant's own scope_type/scope_id via app.scope_company_id() -- so
-- employee_roles_select is rescoped identically, for consistency between
-- what a caller can read and write. review_delegations has no
-- scope_type/scope_id of its own; it's scoped instead by the DELEGATOR's
-- current company via app.employee_current_company_id(), the same
-- actor-based scoping 049 used for audit_log.
-- ============================================================================

drop policy employee_roles_select on employee_roles;
create policy employee_roles_select on employee_roles for select
  using (
    employee_id = app.current_employee_id()
    or (scope_type = 'self' and app.has_permission(app.current_employee_id(), 'role', 'manage'))
    or (scope_type <> 'self' and app.has_permission_on_company(app.current_employee_id(), app.scope_company_id(scope_type, scope_id), 'role', 'manage'))
  );

drop policy review_delegations_select on review_delegations;
create policy review_delegations_select on review_delegations for select
  using (
    delegator_employee_id = app.current_employee_id()
    or delegate_employee_id = app.current_employee_id()
    or app.has_permission_on_company(
      app.current_employee_id(),
      app.employee_current_company_id(delegator_employee_id),
      'role', 'manage'
    )
  );

drop policy review_delegations_revoke on review_delegations;
create policy review_delegations_revoke on review_delegations for update
  using (
    delegator_employee_id = app.current_employee_id()
    or app.has_permission_on_company(
      app.current_employee_id(),
      app.employee_current_company_id(delegator_employee_id),
      'role', 'manage'
    )
  )
  with check (revoked_at is not null);
