-- ============================================================================
-- 018_projects_select_scope_leak.sql
--
-- Found while writing 017, before shipping: projects_select's read_all
-- clause was `app.has_permission(app.current_employee_id(), 'project',
-- 'read_all')` -- unscoped, same bug class as 017's mutate policies, but
-- worse here because it's SELECT: anyone holding project.read_all in ANY
-- one company would see EVERY company's projects, a genuine cross-tenant
-- data leak, not just an over-broad write. 017's own project_members_select
-- fix carried the same unscoped clause over by copying the existing
-- pattern -- fixing both here in one pass rather than shipping the leak and
-- re-discovering it later.
--
-- Uses the same app.has_permission_on_company() helper as every other
-- scope-aware policy: "do you hold this permission, and is this company one
-- you have an accessible grant for" -- the established definition of
-- "scoped" in this codebase (013/015/016/017), not a new stricter standard.
-- ============================================================================

drop policy projects_select on projects;
create policy projects_select on projects for select
  using (
    exists (select 1 from project_members pm where pm.project_id = projects.id and pm.employee_id = app.current_employee_id())
    or owner_employee_id = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'read_all')
  );

drop policy project_members_select on project_members;
create policy project_members_select on project_members for select
  using (
    employee_id = app.current_employee_id()
    or exists (select 1 from project_members pm2 where pm2.project_id = project_members.project_id and pm2.employee_id = app.current_employee_id())
    or exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from projects where id = project_members.project_id),
      'project', 'read_all'
    )
    or app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from projects where id = project_members.project_id),
      'project', 'update_all'
    )
  );
