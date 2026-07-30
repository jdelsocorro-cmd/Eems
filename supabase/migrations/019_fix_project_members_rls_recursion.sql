-- ============================================================================
-- 019_fix_project_members_rls_recursion.sql
--
-- Real bug found live, not in review: projects_select (018) has a direct
-- correlated subquery into project_members ("is the caller a member of this
-- project"), and project_members_select/mutate (017/018) had direct
-- correlated subqueries back into projects ("is the caller this project's
-- owner"). A subquery inside an RLS policy expression runs AS THE CALLING
-- ROLE -- RLS-enforced, same as any other query -- so evaluating
-- projects_select re-triggers project_members_select, which re-triggers
-- projects_select, forever: Postgres correctly raises "infinite recursion
-- detected in policy for relation project_members" rather than hanging.
-- Surfaced immediately on the very first live INSERT ... RETURNING into
-- projects.
--
-- Fix: exactly the pattern already used everywhere else in this schema for
-- cross-table lookups from inside a policy (position_company_id,
-- scope_company_id, has_permission_on_company) -- wrap the projects-side
-- lookup in a SECURITY DEFINER function. A SECURITY DEFINER function runs
-- as its OWNER (the migration-applying admin role), and table owners bypass
-- RLS by default in Postgres (no FORCE ROW LEVEL SECURITY is set anywhere
-- in this schema), so the lookup inside the function never re-enters
-- projects_select at all -- it just reads the row directly. Only the
-- project_members-side policies needed this treatment: once they stop
-- calling back into projects_select, the cycle is broken and projects_
-- select's own direct subquery into project_members is safe exactly as
-- before (project_members_select no longer queries projects, so there's
-- nothing for it to recurse into).
-- ============================================================================

create or replace function app.project_company_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select company_id from projects where id = p_project_id;
$$;

create or replace function app.project_owner_id(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select owner_employee_id from projects where id = p_project_id;
$$;

drop policy project_members_select on project_members;
create policy project_members_select on project_members for select
  using (
    employee_id = app.current_employee_id()
    or exists (select 1 from project_members pm2 where pm2.project_id = project_members.project_id and pm2.employee_id = app.current_employee_id())
    or app.project_owner_id(project_members.project_id) = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_members.project_id), 'project', 'read_all')
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_members.project_id), 'project', 'update_all')
  );

drop policy project_members_mutate on project_members;
create policy project_members_mutate on project_members for all
  using (
    app.project_owner_id(project_members.project_id) = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_members.project_id), 'project', 'update_all')
  )
  with check (
    app.project_owner_id(project_members.project_id) = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_members.project_id), 'project', 'update_all')
  );
