-- ============================================================================
-- 010_grant_app_schema_to_authenticated.sql
--
-- Bug found via integration testing: RLS policies that reference app.*
-- functions (006_rls_policies.sql) work fine without this grant, because a
-- policy's function references are resolved once at CREATE POLICY time by a
-- privileged role and don't get re-checked for schema USAGE on each query.
-- But application code that calls these functions directly via fresh ad-hoc
-- SQL -- core/deps.py's get_current_employee() (`select
-- app.current_employee_id()`) and require_permission() (`select
-- app.has_permission(...)`) -- DOES need fresh name resolution, which
-- requires the querying role (`authenticated`, after
-- `SET LOCAL ROLE authenticated` in db/session.py) to have USAGE on the
-- `app` schema. Without this, every request past the JWT-decode step would
-- fail with "permission denied for schema app".
-- ============================================================================

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;

-- So functions added by future migrations don't silently need a repeat of
-- this grant.
alter default privileges in schema app grant execute on functions to authenticated;
