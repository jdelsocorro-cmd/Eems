-- ============================================================================
-- 027_task_categories.sql
--
-- Adds an admin-editable "task category" lookup (Adhoc, Support, Reporting,
-- BAU, Data Management, Other by default) so tasks -- standalone or inside a
-- project -- can be classified for reporting, independent of which project
-- (if any) they belong to. Project and category are orthogonal: a project
-- doesn't have a status/owner/dates in the way a "BAU" or "Adhoc" label
-- does, so this is a separate lookup table rather than fake entries in the
-- projects list.
--
-- Any employee can create a new category inline from the task form (a
-- shared label, low risk, matches how task creation itself has no
-- permission gate -- see tasks_insert in 006_rls_policies.sql). Renaming or
-- deactivating an existing category reuses the org_structure.manage
-- permission that already gates org_units, since an uncontrolled rename
-- would silently break everyone else's reporting.
-- ============================================================================

create table task_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_task_categories_company_name unique (company_id, name)
);

create trigger trg_task_categories_updated_at
  before update on task_categories
  for each row execute function app.set_updated_at();

create index idx_task_categories_company on task_categories(company_id) where is_active;

alter table tasks add column task_category_id uuid references task_categories(id);

alter table task_categories enable row level security;

create policy task_categories_select on task_categories for select
  using (company_id in (select app.employee_accessible_company_ids(app.current_employee_id())));

create policy task_categories_insert on task_categories for insert
  with check (company_id in (select app.employee_accessible_company_ids(app.current_employee_id())));

create policy task_categories_update on task_categories for update
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'));

create trigger trg_audit_task_categories
  after insert or update or delete on task_categories
  for each row execute function app.write_audit_log();

-- Seed defaults for every company that already exists. New companies get
-- the same set from create_company() in app/api/v1/routers/companies.py --
-- this insert is a one-time backfill, not the ongoing seeding mechanism.
insert into task_categories (company_id, name)
select c.id, cat.name
from companies c
cross join (values ('Adhoc'), ('Support'), ('Reporting'), ('BAU'), ('Data Management'), ('Other')) as cat(name);
