-- ============================================================================
-- 047_engagement_tracking.sql
--
-- Three small, additive columns/functions backing the KPIs picked to judge
-- whether the UX delight pass (Option B from the ops-excellence-architect
-- review, 2026-09-04) actually moved adoption, not just "looks nicer":
--
--   1. employees.last_login_at -- lets the frontend detect "this is this
--      person's very first session ever" (last_login_at was null going in)
--      to show a one-time welcome banner, AND gives login-frequency/
--      days-active a real data source where today there is none.
--   2. help_articles.view_count -- lets Jayson literally see whether adding
--      a first-login pointer to the walkthrough article increases how often
--      it's opened, instead of guessing.
--
-- No RLS policy changes needed for last_login_at -- employees_update
-- (006_rls_policies.sql) already allows an employee to update their own row
-- (id = current_employee_id()), and this is just one more column on it.
-- view_count is different: an ordinary employee reading a published article
-- holds no help_articles.manage grant, so help_articles_mutate would block a
-- plain UPDATE. A narrow SECURITY DEFINER function is the same shape as
-- every other "this one specific write needs broader-than-normal access"
-- case in this schema (org_unit_closure maintenance, audit logging) --
-- scoped to company membership only (mirrors help_articles_select's own
-- company-membership clause), not the article's finer published/role-
-- restricted visibility, since by the time the frontend calls this the
-- caller has already legitimately fetched the article through the real
-- (fully RLS-checked) GET endpoint. EXECUTE is granted automatically to
-- `authenticated` via 010_grant_app_schema_to_authenticated.sql's default
-- privilege on the app schema, so no explicit GRANT statement is needed here.
-- ============================================================================

alter table employees add column last_login_at timestamptz;

alter table help_articles add column view_count integer not null default 0;

create or replace function app.increment_help_article_view(p_article_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  update help_articles
  set view_count = view_count + 1
  where id = p_article_id
    and company_id in (select app.employee_accessible_company_ids(app.current_employee_id()));
end;
$$;
