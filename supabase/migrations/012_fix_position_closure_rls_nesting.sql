-- ============================================================================
-- 012_fix_position_closure_rls_nesting.sql
--
-- Bug found via integration testing: position_closure_select's policy
-- (011_org_structure_visibility_via_grants.sql) joined through the
-- `positions` table in its own subquery -- but positions is ITSELF
-- RLS-protected, so evaluating position_closure's policy triggered a nested
-- evaluation of positions' own RLS policy inside the subquery. This
-- returned zero rows even when the same logical join, run as a direct
-- top-level query, correctly returned the expected position -- confirmed
-- by testing the identical subquery both ways. Rather than chase the exact
-- Postgres internals of why nested RLS-on-RLS silently empties out here,
-- the fix is the standard, more robust pattern anyway: wrap the cross-table
-- lookup in a SECURITY DEFINER function (bypasses RLS deliberately, same
-- as every other app.* helper) instead of embedding a raw subquery over an
-- RLS-protected table directly inside another table's policy.
-- ============================================================================

create or replace function app.position_company_id(p_position_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select d.company_id
  from positions p
  join teams t on t.id = p.team_id
  join departments d on d.id = t.department_id
  where p.id = p_position_id;
$$;

drop policy position_closure_select on position_closure;
create policy position_closure_select on position_closure for select
  using (
    app.position_company_id(ancestor_position_id) in (
      select app.employee_accessible_company_ids(app.current_employee_id())
    )
  );

drop policy position_hierarchy_history_select on position_hierarchy_history;
create policy position_hierarchy_history_select on position_hierarchy_history for select
  using (
    app.position_company_id(position_id) in (
      select app.employee_accessible_company_ids(app.current_employee_id())
    )
  );
