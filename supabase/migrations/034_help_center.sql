-- ============================================================================
-- 034_help_center.sql
--
-- DB-backed Help/SOP content with an in-app editor -- categories, tags,
-- draft/published/archived status, role-based visibility, full-text search,
-- and version history. Company-scoped like everything else in this schema
-- (task_categories, goals, kpis) so a future second company on EEMS gets its
-- own SOPs rather than a shared global pile.
--
-- Body is stored as plain markdown (not a proprietary rich-text JSON blob)
-- deliberately -- "AI-ready" per the requirements this was built against:
-- an LLM (or a future search/summarize feature) can consume it directly with
-- zero migration. Images/attachments are markdown links to externally-hosted
-- URLs, not binary uploads -- same "URL-based evidence, not file storage"
-- precedent completion_evidence_links (030) already established; wiring a
-- general-purpose uploader for article bodies is real standalone infra,
-- deferred.
--
-- New permission `help_articles.manage`, granted to Super Admin only per
-- Jayson's explicit "only authorized administrators can create or edit
-- content" -- unlike completion.review (030), this does NOT extend to
-- Department Head/Manager; SOP authorship is centralized by design here.
-- ============================================================================

insert into permissions (resource, action, description) values
  ('help_articles', 'manage', 'Create, edit, publish, and manage visibility of Help Center articles and categories');

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000001', id from permissions where (resource, action) = ('help_articles', 'manage');

create type help_article_status as enum ('draft', 'published', 'archived');

create table help_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_help_categories_company_name unique (company_id, name)
);

create trigger trg_help_categories_updated_at
  before update on help_categories
  for each row execute function app.set_updated_at();

create index idx_help_categories_company on help_categories(company_id) where is_active;

create table help_articles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  category_id uuid references help_categories(id),
  title text not null,
  body_markdown text not null,
  tags text[] not null default '{}',
  status help_article_status not null default 'draft',
  search_vector tsvector generated always as
    (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body_markdown, ''))) stored,
  created_by uuid references employees(id),
  updated_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_help_articles_updated_at
  before update on help_articles
  for each row execute function app.set_updated_at();

create index idx_help_articles_company on help_articles(company_id);
create index idx_help_articles_category on help_articles(category_id);
create index idx_help_articles_search on help_articles using gin(search_vector);
create index idx_help_articles_tags on help_articles using gin(tags);

-- Empty set for an article = visible to every employee of the company (the
-- common case). Non-empty = restricted to whoever holds one of the listed
-- roles -- reuses employee_roles directly rather than inventing a parallel
-- visibility mechanism.
create table help_article_roles (
  article_id uuid not null references help_articles(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, role_id)
);

-- Append-only edit history -- NO client insert policy, written only by the
-- trigger below. Mirrors the kpi_value_history / task_status_history
-- "trigger-only audit table" pattern already used throughout this schema.
-- Stores the PRE-edit state (current state always lives in help_articles
-- itself), so this is "every prior version", not "every version including
-- the current one".
create table help_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references help_articles(id) on delete cascade,
  version_no int not null,
  title text not null,
  body_markdown text not null,
  edited_by uuid references employees(id),
  edited_at timestamptz not null default now()
);

create index idx_help_article_versions_article on help_article_versions(article_id, version_no desc);

create or replace function app.snapshot_help_article_version()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_next_version int;
begin
  select coalesce(max(version_no), 0) + 1 into v_next_version
  from help_article_versions where article_id = old.id;

  insert into help_article_versions (article_id, version_no, title, body_markdown, edited_by, edited_at)
  values (old.id, v_next_version, old.title, old.body_markdown, app.current_employee_id(), now());

  return new;
end;
$$;

create trigger trg_help_articles_version_snapshot
  after update of title, body_markdown on help_articles
  for each row
  when (old.title is distinct from new.title or old.body_markdown is distinct from new.body_markdown)
  execute function app.snapshot_help_article_version();

alter table help_categories enable row level security;
alter table help_articles enable row level security;
alter table help_article_roles enable row level security;
alter table help_article_versions enable row level security;

create policy help_categories_select on help_categories for select
  using (company_id in (select app.employee_accessible_company_ids(app.current_employee_id())));

create policy help_categories_mutate on help_categories for all
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage'));

-- Published + (unrestricted OR caller holds a listed role) is what any
-- ordinary employee sees; authors/admins additionally see everything
-- (including their own drafts) via the has_permission_on_company branch.
create policy help_articles_select on help_articles for select
  using (
    company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    and (
      app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage')
      or (
        status = 'published'
        and (
          not exists (select 1 from help_article_roles har where har.article_id = help_articles.id)
          or exists (
            select 1 from help_article_roles har
            join employee_roles er on er.role_id = har.role_id
            where har.article_id = help_articles.id
              and er.employee_id = app.current_employee_id()
              and (er.expires_at is null or er.expires_at > now())
          )
        )
      )
    )
  );

create policy help_articles_mutate on help_articles for all
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'help_articles', 'manage'));

-- Composes with help_articles' own RLS (same "exists against the parent,
-- parent's RLS already applies" pattern completion_evidence_links_select
-- uses) -- an ordinary employee who can see the published article can also
-- see which roles restrict it; only authors/admins can change it.
create policy help_article_roles_select on help_article_roles for select
  using (exists (select 1 from help_articles ha where ha.id = article_id));

create policy help_article_roles_mutate on help_article_roles for all
  using (exists (
    select 1 from help_articles ha where ha.id = article_id
      and app.has_permission_on_company(app.current_employee_id(), ha.company_id, 'help_articles', 'manage')
  ))
  with check (exists (
    select 1 from help_articles ha where ha.id = article_id
      and app.has_permission_on_company(app.current_employee_id(), ha.company_id, 'help_articles', 'manage')
  ));

-- Edit history is an authoring tool, not end-user-facing -- same gate as
-- editing the article itself. No insert/update/delete policy: the trigger
-- (security definer) is the only write path.
create policy help_article_versions_select on help_article_versions for select
  using (exists (
    select 1 from help_articles ha where ha.id = article_id
      and app.has_permission_on_company(app.current_employee_id(), ha.company_id, 'help_articles', 'manage')
  ));

create trigger trg_audit_help_categories
  after insert or update or delete on help_categories
  for each row execute function app.write_audit_log();

create trigger trg_audit_help_articles
  after insert or update or delete on help_articles
  for each row execute function app.write_audit_log();

create trigger trg_audit_help_article_roles
  after insert or delete on help_article_roles
  for each row execute function app.write_audit_log_composite_key();
