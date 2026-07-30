-- ============================================================================
-- 017_scope_aware_projects_mutate.sql
--
-- Same scope-blind bug class as 013/015/016: projects_insert / projects_update
-- / project_members_mutate (006_rls_policies.sql) used the plain
-- app.has_permission(employee_id, 'project', 'create'|'update_all') -- checks
-- the permission is held AT ALL, not that it's scoped to the project's own
-- company. A project.create grant scoped to Company A would let its holder
-- create (and, via update_all, edit) projects in Company B too. Found by
-- re-auditing the existing RLS before building the Projects/Tasks routers on
-- top of it (task 8), the same audit habit that caught this pattern in
-- org_structure/RBAC/position_assignments.
--
-- tasks_insert/tasks_update are NOT affected -- they're already
-- self/assignee/accessible_employee_ids-scoped via the position hierarchy,
-- not a blanket has_permission() check, so there's nothing to fix there.
-- ============================================================================

drop policy projects_insert on projects;
create policy projects_insert on projects for insert
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'create'));

drop policy projects_update on projects;
create policy projects_update on projects for update
  using (
    owner_employee_id = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'update_all')
  )
  with check (
    owner_employee_id = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'update_all')
  );

drop policy project_members_mutate on project_members;
create policy project_members_mutate on project_members for all
  using (
    exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from projects where id = project_members.project_id),
      'project', 'update_all'
    )
  )
  with check (
    exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from projects where id = project_members.project_id),
      'project', 'update_all'
    )
  );

-- RETURNING-visibility gap (same class as the company/employee creation bugs
-- in 013/014, found by working through the mechanics before it could bite in
-- testing rather than after): a project owner who is NOT already a
-- project_members row themselves (ownership lives on projects.owner_
-- employee_id, membership is a separate table) adding their FIRST teammate
-- would have the INSERT's WITH CHECK pass (owner_employee_id = self, above)
-- but RETURNING re-checks the new row against project_members_select, whose
-- old definition had no owner-of-parent-project clause -- only "you're
-- already a member" or "you hold read_all". Fixed directly via the existing
-- projects.owner_employee_id column, the same "resolve visibility through an
-- existing column" style as 014's created_by fix, rather than an auto-grant
-- trigger like 013's -- simpler here because the parent row already carries
-- an unambiguous owner. Also extended to update_all holders, so SELECT
-- visibility is a strict superset of mutate rights (if you can edit
-- membership company-wide, you can see it), covering the case where the
-- creator of a project isn't its owner (an exec creating it on someone
-- else's behalf).
drop policy project_members_select on project_members;
create policy project_members_select on project_members for select
  using (
    employee_id = app.current_employee_id()
    or exists (select 1 from project_members pm2 where pm2.project_id = project_members.project_id and pm2.employee_id = app.current_employee_id())
    or exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission(app.current_employee_id(), 'project', 'read_all')
    or app.has_permission_on_company(
      app.current_employee_id(),
      (select company_id from projects where id = project_members.project_id),
      'project', 'update_all'
    )
  );
