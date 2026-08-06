-- ============================================================================
-- 043_reachable_employee_ids_shared_visibility.sql
--
-- Found while live-testing Performance Review Center: a caller whose ONLY
-- access to a subordinate is an RBAC scope grant (position_subtree/org_unit/
-- company, via app.accessible_employee_ids()) -- without also structurally
-- occupying a position in that person's reporting chain (app.hierarchy_
-- subtree_employee_ids(), 040_employee_360_hierarchy_visibility.sql) -- could
-- already see that subordinate's tasks/goals/kpis/kpi_scores/recognitions/
-- completion-submissions, but NOT their projects. Root cause: tasks_select,
-- goals_select (individual branch), kpis_select, kpi_scores_select,
-- recognitions_select, position_assignments_select, and employees_select all
-- independently repeat the same "X in accessible_employee_ids(...) OR X in
-- hierarchy_subtree_employee_ids(...)" pair -- but projects_select only ever
-- got the hierarchy branch (018_projects_select_scope_leak.sql, then 040),
-- never the accessible_employee_ids one. milestones_select and completion_
-- submissions_select's project/milestone branches inline the SAME project-
-- ownership check (the established pattern for RLS subqueries reaching
-- across tables in this schema, since a policy can't literally invoke
-- another table's policy) and so inherited the identical gap, minus even the
-- hierarchy branch in milestones_select's case.
--
-- Fix: one new function, app.reachable_employee_ids(employee_id) =
-- accessible_employee_ids(employee_id) UNION hierarchy_subtree_employee_ids
-- (employee_id) -- no prior consolidation like this exists anywhere in this
-- codebase (every existing `union select` combines branches inside ONE
-- function's own body, never two independently-named functions together).
-- Wired into ALL ten policies below: the seven that already combined both
-- mechanisms get a straight refactor (collapses two OR-branches into one
-- function call, same resulting visibility, easier to keep in sync going
-- forward); projects_select, milestones_select, and completion_submissions_
-- select's project/milestone branches get the accessible_employee_ids
-- coverage they were missing.
--
-- Deliberately NOT used for mutate-authorization -- reachable_employee_ids()
-- is wired ONLY into SELECT policies here, exactly matching 040's own stated
-- reason for keeping hierarchy_subtree_employee_ids out of accessible_
-- employee_ids in the first place: accessible_employee_ids() also gates
-- has_permission_on_employee(), which in turn gates every MUTATE policy in
-- the app (kpi target changes, goal management, employee updates, ...).
-- Folding hierarchy into a function used there would silently widen EDITING
-- scope, not just viewing. app.accessible_employee_ids(),
-- app.hierarchy_subtree_employee_ids(), and app.has_permission_on_employee()
-- are all untouched by this migration.
--
-- Every branch below is joined with OR (no `restrictive` policy exists
-- anywhere in this schema) and nothing is removed from any current body --
-- this is a pure visibility expansion. project_members_select is
-- deliberately NOT touched: its employee_id column identifies who's a
-- member of a project, not an owner/assignee whose visibility should be
-- gated by "can the caller see this person" -- different semantics, out of
-- scope here.
-- ============================================================================

-- app.reachable_employee_ids(employee_id)
-- Everyone the caller can see for SELECT-visibility purposes, combining both
-- mechanisms this schema uses: RBAC scope grants (accessible_employee_ids,
-- any of company/org_unit/position_subtree/self) and management-hierarchy
-- visibility (hierarchy_subtree_employee_ids, purely from the reporting-line
-- position_closure). See header comment above for why this is SELECT-only.
create or replace function app.reachable_employee_ids(p_employee_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select app.accessible_employee_ids(p_employee_id)
  union
  select app.hierarchy_subtree_employee_ids(p_employee_id)
$$;

-- employees_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy employees_select on employees;
create policy employees_select on employees for select
  using (
    id = app.current_employee_id()
    or id in (select app.reachable_employee_ids(app.current_employee_id()))
    or created_by = app.current_employee_id()
  );

-- tasks_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    assignee_employee_id = app.current_employee_id()
    or assigner_employee_id = app.current_employee_id()
    or assignee_employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- goals_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy goals_select on goals;
create policy goals_select on goals for select
  using (
    (goal_type in ('company', 'org_unit')
      and company_id in (select app.employee_accessible_company_ids(app.current_employee_id())))
    or (goal_type = 'individual'
      and (employee_id = app.current_employee_id()
           or employee_id in (select app.reachable_employee_ids(app.current_employee_id()))))
  );

-- kpis_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy kpis_select on kpis;
create policy kpis_select on kpis for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- kpi_scores_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy kpi_scores_select on kpi_scores;
create policy kpi_scores_select on kpi_scores for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- recognitions_select -- latest body: 040_employee_360_hierarchy_visibility.sql
drop policy recognitions_select on recognitions;
create policy recognitions_select on recognitions for select
  using (
    employee_id = app.current_employee_id()
    or given_by = app.current_employee_id()
    or employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- position_assignments_select -- latest body: 041_fix_position_assignments_select_for_hierarchy.sql
drop policy position_assignments_select on position_assignments;
create policy position_assignments_select on position_assignments for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- projects_select -- gap fix: gains the accessible_employee_ids coverage it
-- never had (only ever got the hierarchy branch, in 018/040).
drop policy projects_select on projects;
create policy projects_select on projects for select
  using (
    exists (select 1 from project_members pm where pm.project_id = projects.id and pm.employee_id = app.current_employee_id())
    or owner_employee_id = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'read_all')
    or owner_employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
  );

-- milestones_select -- gap fix: never got EITHER branch (029_milestones.sql
-- was never touched by 040/041). Mirrors projects_select's shape exactly,
-- applied to the milestone's parent project.
drop policy milestones_select on milestones;
create policy milestones_select on milestones for select
  using (
    exists (
      select 1 from projects p
      where p.id = milestones.project_id
        and (
          exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
          or p.owner_employee_id = app.current_employee_id()
          or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all')
          or p.owner_employee_id in (select app.reachable_employee_ids(app.current_employee_id()))
        )
    )
  );

-- completion_submissions_select -- gap fix on the project/milestone
-- branches (same inline ownership check as projects_select, same missing
-- coverage); task branch's assignee check upgraded from accessible_
-- employee_ids to reachable_employee_ids (closes a smaller gap: an assignee
-- who is hierarchy-reachable but didn't submit anything themselves wasn't
-- covered by the outer submitter-keyed branch); outer submitted_by branch
-- upgraded the same way, for Employee 360's Activity Timeline and any
-- future "everything this person submitted" view.
drop policy completion_submissions_select on completion_submissions;
create policy completion_submissions_select on completion_submissions for select
  using (
    submitted_by = app.current_employee_id()
    or reviewed_by = app.current_employee_id()
    or (entity_type = 'task' and exists (
      select 1 from tasks t where t.id = completion_submissions.entity_id
        and (t.assignee_employee_id = app.current_employee_id()
             or t.assigner_employee_id = app.current_employee_id()
             or t.assignee_employee_id in (select app.reachable_employee_ids(app.current_employee_id())))
    ))
    or (entity_type = 'project' and exists (
      select 1 from projects p where p.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all')
             or p.owner_employee_id in (select app.reachable_employee_ids(app.current_employee_id())))
    ))
    or (entity_type = 'milestone' and exists (
      select 1 from milestones m join projects p on p.id = m.project_id where m.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all')
             or p.owner_employee_id in (select app.reachable_employee_ids(app.current_employee_id())))
    ))
    or app.is_eligible_completion_reviewer(app.current_employee_id(), entity_type, entity_id)
    or submitted_by in (select app.reachable_employee_ids(app.current_employee_id()))
  );
