-- ============================================================================
-- 023_scoped_project_ids_for_dashboards.sql
--
-- Real bug found live while building task 10's dashboards: the team/
-- department task-count query joined tasks to projects purely to resolve
-- "which projects belong to this team/department" (projects has team_id/
-- department_id columns tasks doesn't). But that join means BOTH tables'
-- RLS applies -- so a manager who can see a task via tasks_select's own
-- assignee-subtree visibility (accessible_employee_ids) but who ISN'T a
-- project member/owner/read_all holder (a different, unrelated permission
-- axis -- projects_select) got that task silently dropped from the count,
-- because the inner join to projects returned nothing for them. Confirmed
-- via the live test: a manager with a valid position_subtree grant over
-- their own report correctly saw headcount, but zero tasks for a task
-- they're clearly allowed to see on its own.
--
-- Fix: resolve "which project ids fall in this scope" via a SECURITY
-- DEFINER function that bypasses RLS on projects for that lookup only --
-- same technique as 019/020's project_owner_id/project_company_id. This
-- means scope resolution no longer requires projects_select visibility;
-- tasks_select is still the only thing that decides whether the caller can
-- see each task, which is the authorization axis that should actually
-- apply here.
-- ============================================================================

create or replace function app.project_ids_in_scope(p_scope_type text, p_scope_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select id from projects
  where deleted_at is null
    and (
      (p_scope_type = 'company' and company_id = p_scope_id)
      or (p_scope_type = 'department' and department_id = p_scope_id)
      or (p_scope_type = 'team' and team_id = p_scope_id)
    );
$$;
