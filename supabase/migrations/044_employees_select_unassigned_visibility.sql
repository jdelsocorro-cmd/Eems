-- ============================================================================
-- 044_employees_select_unassigned_visibility.sql
--
-- Found live-testing Org Chart's new Assign Consultant feature: its
-- "Existing Employee" mode showed zero candidates even though unassigned
-- employees existed in the company. Root cause is in employees_select
-- (latest body: 014_employee_created_by_visibility.sql), not the new
-- feature -- an employee with no current primary position_assignment can
-- never appear in app.reachable_employee_ids() for ANY viewer, because both
-- of its branches (accessible_employee_ids, hierarchy_subtree_employee_ids)
-- are defined entirely in terms of position_assignments joins. Combined
-- with employees_select's only other branch ("created_by = you"), this
-- means an unassigned employee is invisible to literally everyone except
-- whoever personally created them -- including a Super Admin, regardless of
-- permission held. Same gap silently affects the Users admin page
-- (UserManagement.tsx), which calls the same GET /employees endpoint with
-- no override.
--
-- The obvious fix -- add a blanket `has_permission(caller, 'org_structure',
-- 'manage')` OR-branch -- is exactly the scope-leak pattern
-- 013_scope_aware_org_structure_mutate.sql already closed once for
-- companies/departments/teams/positions (a permission holder at ANY scope
-- could see rows in companies they have no grant for). That fix required
-- checking the permission against the SPECIFIC ROW's company via
-- has_permission_on_company(). employees has no such column to check
-- against, though -- an unassigned employee (no position, so no org_unit,
-- so no company) has no company to scope against, structurally, the exact
-- same chicken-and-egg gap 013 itself hit for company creation and solved
-- differently there (creator-becomes-admin trigger). POST /employees's own
-- require_permission("employee","create") dependency already accepts this
-- same tradeoff explicitly (see its docstring in
-- app/api/v1/routers/employees.py): employee.create is deliberately NOT
-- company-scoped, because a brand-new employee has no company to scope
-- against either, and at Phase 1 (single-tenant EDGE, one company total)
-- the risk is low.
--
-- This migration applies that SAME already-accepted tradeoff to SELECT, but
-- narrower than 013 would ever allow for a company-scopeable resource: the
-- new branch only fires for rows with NO current primary position_
-- assignment (org_structure.manage OR employee.create, held at ANY scope).
-- Every employee who DOES have a company (i.e. holds a current position) is
-- completely untouched -- still gated exclusively by reachable_employee_ids
-- /created_by, exactly as before. This does not reopen 013's hole: 013 was
-- about mutating/seeing SCOPEABLE company-owned rows across company
-- boundaries; this is strictly about the one population that was never
-- scopeable by company in the first place.
--
-- Caught live (before this ever shipped) via the accompanying integration
-- test: the "no current primary assignment" check MUST run as a SECURITY
-- DEFINER function, not an inline subquery in the policy body. An inline
-- `not exists (select 1 from position_assignments ...)` runs under the
-- CALLER's own permissions -- and position_assignments has its own RLS
-- (position_assignments_select), which hides rows the caller can't already
-- reach. For a caller who can't see a given employee's assignment (exactly
-- the population org_structure.manage/employee.create holders often can't,
-- by definition -- that's the whole reason this migration exists), the
-- subquery would find nothing and wrongly conclude "unassigned", flipping
-- this into an accidental blanket-visibility hole into ASSIGNED employees
-- too -- the exact thing this migration's own comments above say it must
-- not do. Every existing cross-table RLS helper in this schema
-- (has_permission, accessible_employee_ids, hierarchy_subtree_employee_ids,
-- reachable_employee_ids, has_permission_on_employee/_company) is SECURITY
-- DEFINER for precisely this reason; this migration now follows the same
-- rule rather than being the one exception.
-- ============================================================================

-- app.employee_has_no_current_primary_assignment(employee_id)
-- SECURITY DEFINER so this reflects ground truth (does ANY current primary
-- position_assignment row exist for this employee) rather than "can the
-- calling session see one" -- see header comment above for why the inline
-- version was wrong.
create or replace function app.employee_has_no_current_primary_assignment(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select not exists (
    select 1 from position_assignments pa
    where pa.employee_id = p_employee_id and pa.is_primary and pa.end_date is null
  )
$$;

drop policy employees_select on employees;
create policy employees_select on employees for select
  using (
    id = app.current_employee_id()
    or id in (select app.reachable_employee_ids(app.current_employee_id()))
    or created_by = app.current_employee_id()
    or (
      app.employee_has_no_current_primary_assignment(employees.id)
      and (
        app.has_permission(app.current_employee_id(), 'org_structure', 'manage')
        or app.has_permission(app.current_employee_id(), 'employee', 'create')
      )
    )
  );
