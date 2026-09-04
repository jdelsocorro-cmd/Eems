-- ============================================================================
-- 048_org_unit_scoped_kpi_templates.sql
--
-- kpi_templates_mutate has been company-wide-only since
-- 021_scope_aware_goals_kpi_templates_mutate.sql -- that migration's own
-- comment flagged this as the same scope-blind bug class as goal.manage
-- (fixed in 046_scope_aware_goals_manage.sql) but deliberately left it
-- unfixed at the time. Confirmed via 007_seed_permissions.sql that this is
-- currently DORMANT, not live -- kpi_template.manage is seeded onto Super
-- Admin only, never Department Head/Manager, so nobody can exploit the gap
-- today. It only matters once a department is meant to own its own KPI
-- templates, which is the prerequisite for cascading a department goal's
-- KPI template onto auto-generated individual goals (the next piece of
-- work after this).
--
-- kpi_templates.applicable_scope_type/applicable_scope_id (005_goals_kpis.
-- sql) are NOT reused for this -- they are documented as a purely
-- informational UI filter, untyped and never touched by the org_units
-- migration (025), not an authorization boundary. Repurposing them for real
-- RLS enforcement would rely on a field whose own design explicitly
-- disclaims that guarantee. org_unit_id is a proper FK instead, the same
-- shape goals.org_unit_id already has.
--
-- null org_unit_id keeps meaning "not department-owned" -- still gated by
-- company-wide kpi_template.manage exactly as before, so nothing already
-- granted company-wide loses access. A non-null org_unit_id requires
-- org-unit-scoped access via app.has_permission_on_org_unit(), the same
-- function 046 built for goals -- reused verbatim, no new abstraction.
-- ============================================================================

alter table kpi_templates add column org_unit_id uuid references org_units(id);
create index idx_kpi_templates_org_unit on kpi_templates(org_unit_id) where is_active;

drop policy kpi_templates_mutate on kpi_templates;
create policy kpi_templates_mutate on kpi_templates for all
  using (
    company_id is not null
    and (
      (org_unit_id is null and app.has_permission_on_company(app.current_employee_id(), company_id, 'kpi_template', 'manage'))
      or (org_unit_id is not null and app.has_permission_on_org_unit(app.current_employee_id(), org_unit_id, 'kpi_template', 'manage'))
    )
  )
  with check (
    company_id is not null
    and (
      (org_unit_id is null and app.has_permission_on_company(app.current_employee_id(), company_id, 'kpi_template', 'manage'))
      or (org_unit_id is not null and app.has_permission_on_org_unit(app.current_employee_id(), org_unit_id, 'kpi_template', 'manage'))
    )
  );
