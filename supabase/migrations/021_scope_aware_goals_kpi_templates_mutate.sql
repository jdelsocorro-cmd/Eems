-- ============================================================================
-- 021_scope_aware_goals_kpi_templates_mutate.sql
--
-- Same scope-blind bug class as 013/015/016/017, found by re-auditing
-- 006_rls_policies.sql before building on top of it for task 9 (goals/KPIs):
--
-- - goals_mutate used plain app.has_permission(employee_id, 'goal',
--   'manage') -- held anywhere, not scoped to the goal's own company. A
--   goal.manage grant scoped to Company A would let its holder create/edit/
--   delete Company B's goals too.
-- - kpi_templates_mutate had the identical issue, plus a second problem:
--   kpi_templates.company_id is nullable (null = global template, meant to
--   be a system-wide library entry), and the unscoped check let ANY holder
--   of kpi_template.manage edit global templates -- there's no such thing
--   as "the company you manage" for a null-company row, so this was
--   effectively unrestricted for the shared library. Fixed the same way
--   013 made system role templates (roles.company_id null) immutable via
--   the API: require company_id is not null.
--
-- goals_select and kpi_templates_select are NOT touched here -- both tie
-- visibility to app.employee_current_company_id() (the company the caller
-- structurally belongs to via their own position), the same
-- non-permission-based model companies_select already uses, not the
-- has_permission()-driven model that caused projects_select's cross-tenant
-- leak in 018. Nothing to fix on the read side.
--
-- kpis_insert/kpis_update are also NOT touched -- they already use
-- app.has_permission_on_employee(), which composes has_permission() with
-- accessible_employee_ids() (subtree scope), the correct scoped pattern
-- from the start.
-- ============================================================================

drop policy goals_mutate on goals;
create policy goals_mutate on goals for all
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'goal', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'goal', 'manage'));

drop policy kpi_templates_mutate on kpi_templates;
create policy kpi_templates_mutate on kpi_templates for all
  using (company_id is not null and app.has_permission_on_company(app.current_employee_id(), company_id, 'kpi_template', 'manage'))
  with check (company_id is not null and app.has_permission_on_company(app.current_employee_id(), company_id, 'kpi_template', 'manage'));
