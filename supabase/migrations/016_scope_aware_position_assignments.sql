-- ============================================================================
-- 016_scope_aware_position_assignments.sql
-- Same class of bug as 013/015, found proactively while building the
-- position-assignment endpoint: position_assignments_mutate used the
-- scope-blind has_permission() check. Assigning/reassigning who holds a
-- position is exactly as company-scoped an action as editing the position
-- itself -- resolve via the position's company like positions_mutate does.
-- ============================================================================

drop policy position_assignments_mutate on position_assignments;
create policy position_assignments_mutate on position_assignments for all
  using (
    app.has_permission_on_company(
      app.current_employee_id(),
      app.position_company_id(position_id),
      'org_structure', 'manage'
    )
  )
  with check (
    app.has_permission_on_company(
      app.current_employee_id(),
      app.position_company_id(position_id),
      'org_structure', 'manage'
    )
  );
