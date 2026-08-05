-- ============================================================================
-- 040_employee_360_hierarchy_visibility.sql
--
-- Employee 360: a read-only workspace where a leader (Supervisor, Manager,
-- Department Head, COO, CEO, Super Admin) can view an employee's full
-- performance picture without navigating My Tasks / My Scorecard / Goals /
-- Projects separately.
--
-- Visibility is scoped by the org's REPORTING-LINE hierarchy (position_
-- closure, driven by positions.reports_to_position_id) -- deliberately NOT
-- org_unit_closure (the structural Division/Department/Team container
-- hierarchy from 024_org_units.sql). Those are two different hierarchies in
-- this schema and they don't have to agree: is_eligible_completion_reviewer
-- (038) and compute_and_snapshot_position_score (033) already both climb
-- position_closure to answer "who's under whom" -- scoping Employee 360 off
-- org_unit_closure instead would make it disagree with Review Queue and
-- Leadership Scorecard about who reports to whom for the same employee.
--
-- app.hierarchy_subtree_employee_ids() is a NEW, separate function -- it is
-- deliberately NOT folded into app.accessible_employee_ids(), because that
-- function also gates has_permission_on_employee(), which in turn gates
-- every MUTATE policy in the app (kpi target changes, goal management,
-- employee updates, ...). Folding hierarchy visibility in there would
-- silently widen EDITING scope for every role that holds some permission
-- somewhere, not just viewing. Keeping this function separate and wired
-- only into SELECT policies is what keeps "hierarchy is additive to RBAC,
-- RBAC still controls editing" actually true.
-- ============================================================================

-- app.hierarchy_subtree_employee_ids(employee_id)
-- Everyone (including the caller) whose CURRENT position is at-or-below any
-- position the caller currently holds, via position_closure -- same shape
-- position_subtree-scoped RBAC grants already use (003_rbac_functions.sql,
-- "position_subtree scope: the granted position and everything under it"),
-- just walked from the caller's own current position instead of a granted
-- one. Returns empty if the caller holds no current position_assignment;
-- harmless, since every policy below already has an independent
-- self-visibility branch.
create or replace function app.hierarchy_subtree_employee_ids(p_employee_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select pa.employee_id
  from position_assignments viewer_pa
  join position_closure pc on pc.ancestor_position_id = viewer_pa.position_id
  join position_assignments pa on pa.position_id = pc.descendant_position_id
  where viewer_pa.employee_id = p_employee_id
    and viewer_pa.end_date is null
    and viewer_pa.is_primary
    and pa.end_date is null
    and pa.is_primary;
$$;

-- ----------------------------------------------------------------------------
-- employee.view_360 -- gates the Employee 360 feature itself (whether a
-- leader can open the workspace at all). Granted to the seeded Super Admin/
-- Department Head/Manager system roles, same explicit-re-grant pattern
-- 034_help_center.sql used for help_articles.manage: 007's Super Admin
-- grant was a one-time snapshot (`select ... from permissions`), so it does
-- not retroactively pick up permissions added in later migrations.
--
-- Supervisor/COO/CEO are Jayson's own custom roles, not seeded here -- he
-- grants them employee.view_360 via RBAC Admin once this ships.
-- ----------------------------------------------------------------------------
insert into permissions (resource, action, description) values
  ('employee', 'view_360', 'Open another employee''s Employee 360 profile (read-only) if they fall within your organizational hierarchy');

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r, permissions p
where r.id in (
  '00000000-0000-0000-0001-000000000001', -- Super Admin
  '00000000-0000-0000-0001-000000000003', -- Department Head
  '00000000-0000-0000-0001-000000000004'  -- Manager
)
and (p.resource, p.action) = ('employee', 'view_360');

-- ----------------------------------------------------------------------------
-- Additive OR-branch on exactly the SELECT policies Employee 360's tabs
-- read through. Every branch below is `or <column> in (select app.
-- hierarchy_subtree_employee_ids(app.current_employee_id()))` against
-- whichever column that policy already keys visibility on -- nothing else
-- in any of these policies changes; current bodies copied verbatim from
-- their latest-defining migration.
-- ----------------------------------------------------------------------------

-- employees_select -- latest body: 014_employee_created_by_visibility.sql
drop policy employees_select on employees;
create policy employees_select on employees for select
  using (
    id = app.current_employee_id()
    or id in (select app.accessible_employee_ids(app.current_employee_id()))
    or created_by = app.current_employee_id()
    or id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- projects_select -- latest body: 018_projects_select_scope_leak.sql
drop policy projects_select on projects;
create policy projects_select on projects for select
  using (
    exists (select 1 from project_members pm where pm.project_id = projects.id and pm.employee_id = app.current_employee_id())
    or owner_employee_id = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'project', 'read_all')
    or owner_employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- tasks_select -- latest body: 006_rls_policies.sql (never redefined since)
drop policy tasks_select on tasks;
create policy tasks_select on tasks for select
  using (
    assignee_employee_id = app.current_employee_id()
    or assigner_employee_id = app.current_employee_id()
    or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    or assignee_employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- goals_select -- latest body: 025_migrate_positions_projects_goals_to_org_units.sql
drop policy goals_select on goals;
create policy goals_select on goals for select
  using (
    (goal_type in ('company', 'org_unit')
      and company_id in (select app.employee_accessible_company_ids(app.current_employee_id())))
    or (goal_type = 'individual'
      and (employee_id = app.current_employee_id()
           or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
           or employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))))
  );

-- kpis_select -- latest body: 006_rls_policies.sql (never redefined since)
drop policy kpis_select on kpis;
create policy kpis_select on kpis for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    or employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- kpi_scores_select -- latest body: 006_rls_policies.sql (never redefined since)
drop policy kpi_scores_select on kpi_scores;
create policy kpi_scores_select on kpi_scores for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    or employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- recognitions_select -- latest body: 032_recognitions.sql
drop policy recognitions_select on recognitions;
create policy recognitions_select on recognitions for select
  using (
    employee_id = app.current_employee_id()
    or given_by = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    or employee_id in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );

-- completion_submissions_select -- latest body: 039_fix_completion_submissions_select_for_hierarchy.sql
-- New branch is submitted_by-keyed (not entity-owner-keyed like the other
-- three entity_type branches) -- feeds Employee 360's Activity Timeline
-- with "everything this employee submitted", independent of who currently
-- owns/is-assigned-to the underlying task/project/milestone.
drop policy completion_submissions_select on completion_submissions;
create policy completion_submissions_select on completion_submissions for select
  using (
    submitted_by = app.current_employee_id()
    or reviewed_by = app.current_employee_id()
    or (entity_type = 'task' and exists (
      select 1 from tasks t where t.id = completion_submissions.entity_id
        and (t.assignee_employee_id = app.current_employee_id()
             or t.assigner_employee_id = app.current_employee_id()
             or t.assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id())))
    ))
    or (entity_type = 'project' and exists (
      select 1 from projects p where p.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all'))
    ))
    or (entity_type = 'milestone' and exists (
      select 1 from milestones m join projects p on p.id = m.project_id where m.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all'))
    ))
    or app.is_eligible_completion_reviewer(app.current_employee_id(), entity_type, entity_id)
    or submitted_by in (select app.hierarchy_subtree_employee_ids(app.current_employee_id()))
  );
