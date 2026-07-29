-- ============================================================================
-- 008_app_role.sql
-- Dedicated Postgres login role for FastAPI's connection pool. Deliberately
-- NOT `postgres` and NOT `service_role` -- both of those carry BYPASSRLS,
-- which would silently defeat every policy in 006_rls_policies.sql. FastAPI
-- authenticates as `eems_app`, then does `SET LOCAL ROLE authenticated` per
-- request (see backend/app/db/session.py) so RLS evaluates exactly as it
-- would for a direct Supabase client call.
--
-- SECURITY: this migration intentionally does NOT set a password -- do not
-- commit one. After running migrations, set it once via the Supabase SQL
-- editor:
--   ALTER ROLE eems_app WITH PASSWORD '<generate a strong one>';
-- and put the resulting connection string in backend/.env as SUPABASE_DB_URL
-- (never in a migration file, never committed).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eems_app') then
    create role eems_app with login;
  end if;
end
$$;

-- Membership in `authenticated` means eems_app inherits the same table
-- grants Supabase already sets up for that role -- RLS policies (which check
-- app.current_employee_id() / auth.uid(), not the Postgres role name) are
-- what actually restrict access, this grant just makes the base
-- INSERT/SELECT/UPDATE/DELETE privilege exist for eems_app to be governed by.
grant authenticated to eems_app;

grant usage on schema public, app to eems_app;

-- BYPASSRLS on the LOGIN role itself, not a contradiction of the "never
-- postgres/service_role" rule above: RLS evaluates the CURRENT role
-- (post-SET ROLE), not the login role. Every user-facing request handler
-- calls `SET LOCAL ROLE authenticated` (db/session.py get_db_for_user),
-- which drops the bypass for that transaction since `authenticated` itself
-- has no BYPASSRLS. Only the small number of deliberate system/cron code
-- paths that skip that SET ROLE step (db/session.py get_db_as_service) run
-- with the bypass active -- e.g. the scoring-snapshot job, which legitimately
-- needs to write kpi_scores across every employee company-wide.
alter role eems_app bypassrls;
