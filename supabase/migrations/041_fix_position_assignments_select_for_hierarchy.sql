-- ============================================================================
-- 041_fix_position_assignments_select_for_hierarchy.sql
--
-- Found via the live Employee 360 test: a manager resolved as visible into
-- a report's employee row (040's hierarchy_subtree_employee_ids branch on
-- employees_select) still got position_title/org_unit_name/manager back as
-- null from GET /employees/{id}/profile-summary. Root cause: that endpoint
-- LEFT JOINs position_assignments to find the target's current position --
-- and position_assignments_select (006_rls_policies.sql) only knows about
-- self/accessible_employee_ids (RBAC-grant-based) visibility, not
-- hierarchy_subtree_employee_ids. Same "a JOIN needs the joined table's own
-- SELECT policy to pass too, not just the parent row's" class of gap
-- documented in 013/039 -- LEFT JOIN doesn't error when RLS blocks the
-- joined row, it just silently returns null, so this shipped without an
-- obvious failure until the live assertion on position_title caught it.
--
-- positions_select and org_units_select don't need the same fix -- both are
-- already company-wide readable (structural data, not PII), confirmed in
-- 025_migrate_positions_projects_goals_to_org_units.sql and
-- 024_org_units.sql. position_assignments is the only position-adjacent
-- table gated by employee-level (not company-level) visibility.
--
-- Fix: same additive OR branch every other 040 policy got, added here to
-- position_assignments_select too. Nothing removed.
-- ============================================================================

drop policy position_assignments_select on position_assignments;
create policy position_assignments_select on position_assignments for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    or employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );
