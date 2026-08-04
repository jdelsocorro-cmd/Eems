-- ============================================================================
-- 028_goal_owner_and_cancelled_status.sql
--
-- Adds owner_employee_id to goals -- who's accountable for driving the goal
-- forward, independent of goal_type. This is deliberately separate from
-- goals.employee_id, which is the *target* of an individual-type goal and
-- is constrained by chk_goals_owner_matches_type (null for company/org_unit
-- goals, required for individual ones). owner_employee_id has no such
-- constraint: a company-wide or org-unit goal has no natural "target"
-- employee, but can still have an accountable owner, which is exactly the
-- gap this closes. No RLS change needed -- goals_mutate
-- (021_scope_aware_goals_kpi_templates_mutate.sql) already gates all column
-- writes via company-scoped goal.manage, not per-column logic.
--
-- Also adds 'cancelled' to goal_status, closing the one gap versus
-- project_status and task_status (both already have it).
-- ============================================================================

alter table goals add column owner_employee_id uuid references employees(id);

alter type goal_status add value 'cancelled';
