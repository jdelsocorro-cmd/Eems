-- ============================================================================
-- 020_fix_project_members_self_reference_recursion.sql
--
-- 019 didn't fully fix the recursion -- confirmed by bisection against the
-- live DB (see scratchpad/bisect_recursion*.py from this session): the
-- actual trigger is project_members_select's own `exists (select 1 from
-- project_members pm2 where pm2.project_id = ... and pm2.employee_id =
-- self)` clause -- a self-referencing subquery that has been in the schema
-- unchanged since 006_rls_policies.sql, just never exercised until task 8
-- wrote the first real code to query these tables.
--
-- That self-join idiom ("am I already a member of this project") is a
-- normal, usually-safe RLS pattern on its own. It becomes unsafe here
-- specifically because projects_select ALSO queries project_members (to
-- check project membership for project visibility) -- so a query that
-- starts on `projects` pulls in project_members_select, which pulls in
-- project_members_select AGAIN via its own self-join, and Postgres's
-- recursion guard (correctly) refuses to keep expanding a policy that
-- re-enters the same relation's policy indefinitely, rather than silently
-- doing something wrong.
--
-- Fix: same technique as 019 applied one level deeper -- wrap the
-- self-membership check in a SECURITY DEFINER function too. Once the query
-- is inside app.is_project_member(), it runs as the function's owner
-- (postgres, which has BYPASSRLS -- confirmed via pg_roles), so it never
-- re-enters project_members_select at all. Verified empirically: removing
-- just this one direct self-join eliminates the recursion; the function
-- form does not, even though it expresses the identical check.
-- ============================================================================

create or replace function app.is_project_member(p_project_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (select 1 from project_members where project_id = p_project_id and employee_id = p_employee_id);
$$;

drop policy project_members_select on project_members;
create policy project_members_select on project_members for select
  using (
    employee_id = app.current_employee_id()
    or app.is_project_member(project_id, app.current_employee_id())
    or app.project_owner_id(project_id) = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_id), 'project', 'read_all')
    or app.has_permission_on_company(app.current_employee_id(), app.project_company_id(project_id), 'project', 'update_all')
  );
