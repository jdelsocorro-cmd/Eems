-- ============================================================================
-- 036_fix_help_articles_rls_recursion.sql
--
-- Found via the live integration test (test_help_and_support_live.py),
-- first real query against help_articles after 034 shipped: "infinite
-- recursion detected in policy for relation help_articles" on a plain
-- INSERT ... RETURNING.
--
-- Same failure class as 019/020_fix_project_members_*_recursion.sql:
-- help_articles_select's role-visibility check queries help_article_roles,
-- and help_article_roles_select's own policy queries help_articles right
-- back -- a query that starts on either table pulls in the other's policy,
-- which pulls the first table's policy again, and Postgres's recursion
-- guard correctly refuses to keep expanding it rather than silently doing
-- something wrong.
--
-- Fix: identical technique to 020 -- wrap the cross-table check in a
-- SECURITY DEFINER function. Once the query is inside
-- app.help_article_visible_by_role(), it runs as the function's owner
-- (postgres, BYPASSRLS), so it never re-enters help_article_roles_select
-- at all, breaking the cycle. help_article_roles_select's own
-- `exists (select 1 from help_articles ...)` check is left as-is -- it's
-- now one-directional (help_article_roles -> help_articles, and
-- help_articles' policy no longer loops back), so it's safe.
-- ============================================================================

create or replace function app.help_article_visible_by_role(p_article_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select
    not exists (select 1 from help_article_roles where article_id = p_article_id)
    or exists (
      select 1 from help_article_roles har
      join employee_roles er on er.role_id = har.role_id
      where har.article_id = p_article_id
        and er.employee_id = p_employee_id
        and (er.expires_at is null or er.expires_at > now())
    );
$$;

drop policy help_articles_select on help_articles;
create policy help_articles_select on help_articles for select
  using (
    company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    and (
      app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage')
      or (status = 'published' and app.help_article_visible_by_role(id, app.current_employee_id()))
    )
  );
