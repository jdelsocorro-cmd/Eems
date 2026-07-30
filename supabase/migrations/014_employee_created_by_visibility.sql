-- ============================================================================
-- 014_employee_created_by_visibility.sql
--
-- Same underlying problem as companies (013): a brand-new employee has no
-- position_assignment yet, so accessible_employee_ids() can't see them, and
-- the creator (e.g. an HR admin provisioning a new hire) would fail the
-- RETURNING-visibility check the same way company creation originally did.
--
-- Deliberately NOT reusing the "blanket has_permission()" shortcut here --
-- that's exactly the scope-leak pattern 013 closed for org-structure
-- tables. Instead: track who created each employee record (also useful for
-- audit, matches the pattern projects/tasks already use) and let
-- employees_select allow "you can see records you personally created" --
-- narrow, not "you can see everything if you hold this permission
-- anywhere."
-- ============================================================================

alter table employees add column created_by uuid references employees(id);

drop policy employees_select on employees;
create policy employees_select on employees for select
  using (
    id = app.current_employee_id()
    or id in (select app.accessible_employee_ids(app.current_employee_id()))
    or created_by = app.current_employee_id()
  );
