-- ============================================================================
-- 042_bulk_import_center.sql
--
-- Bulk Import Center, Phase 1: Employees only. A generic, config-driven
-- upsert-by-business-identifier engine (the module registry lives in
-- app/services/bulk_import.py, not in this schema) -- this migration only
-- adds the audit/staging tables and permission every module will share.
--
-- Employees is the only module wired up in Phase 1 because it's the only
-- one with a real business identifier today: work_email (not null unique)
-- and employee_number (unique, nullable), both declared at table creation
-- in 001_org_hierarchy.sql. Projects/Goals/KPIs have no such column yet --
-- each needs its own migration to add one before it can be registered.
--
-- import_batch_rows IS the audit trail (no separate logging mechanism) and
-- the source for both the preview screen (read before commit) and the
-- downloadable log (read after). old_data is captured per updated row at
-- commit time specifically so a future rollback feature has something to
-- restore -- the rollback action itself is out of scope for this phase.
-- ============================================================================

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  initiated_by uuid not null references employees(id),
  company_id uuid not null references companies(id),
  import_mode text not null check (import_mode in ('insert_only', 'upsert', 'update_only', 'skip_duplicates')),
  field_strategy text not null default 'non_empty_only' check (field_strategy in ('non_empty_only', 'overwrite_all')),
  file_name text not null,
  status text not null default 'staged' check (status in ('staged', 'previewed', 'committed', 'failed', 'rolled_back')),
  row_count int not null default 0,
  inserted_count int not null default 0,
  updated_count int not null default 0,
  skipped_count int not null default 0,
  rejected_count int not null default 0,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references employees(id)
);

create index idx_import_batches_company on import_batches(company_id);
create index idx_import_batches_initiated_by on import_batches(initiated_by);

create table import_batch_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references import_batches(id),
  row_number int not null,
  raw_data jsonb not null,
  matching_key_value text,
  action text not null check (action in ('insert', 'update', 'skip', 'reject')),
  target_record_id uuid,
  old_data jsonb,
  validation_errors jsonb,
  committed_at timestamptz,
  unique (batch_id, row_number)
);

create index idx_import_batch_rows_batch on import_batch_rows(batch_id);

create trigger trg_import_batches_audit
  after insert or update on import_batches
  for each row execute function app.write_audit_log();

create trigger trg_import_batch_rows_audit
  after insert or update on import_batch_rows
  for each row execute function app.write_audit_log();

-- ----------------------------------------------------------------------------
-- Permission: employee.bulk_import gates the FEATURE (route + endpoints) --
-- the actual per-row writes during commit are still independently governed
-- by employees_insert/employees_update RLS, exactly like every other write
-- path in this app. This is not a bypass permission.
-- ----------------------------------------------------------------------------
insert into permissions (resource, action, description) values
  ('employee', 'bulk_import', 'Upload and commit a bulk employee import (Bulk Import Center)');

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r, permissions p
where r.id in (
  '00000000-0000-0000-0001-000000000001', -- Super Admin
  '00000000-0000-0000-0001-000000000002'  -- HR / People Admin
)
and (p.resource, p.action) = ('employee', 'bulk_import');

-- ----------------------------------------------------------------------------
-- RLS: import_batches is PII-adjacent (raw_data snapshots whatever the CSV
-- contained) -- visible to whoever ran it, or anyone who currently holds
-- employee.bulk_import for that company (admin oversight), never company-
-- wide by default the way structural (non-PII) tables like org_units are.
-- import_batch_rows visibility/mutation derives entirely from its parent
-- batch, same parent-scoped-child pattern task_comments_select already uses.
-- ----------------------------------------------------------------------------
alter table import_batches enable row level security;
alter table import_batch_rows enable row level security;

create policy import_batches_select on import_batches for select
  using (
    initiated_by = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'employee', 'bulk_import')
  );

create policy import_batches_insert on import_batches for insert
  with check (
    initiated_by = app.current_employee_id()
    and app.has_permission_on_company(app.current_employee_id(), company_id, 'employee', 'bulk_import')
  );

create policy import_batches_update on import_batches for update
  using (
    initiated_by = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'employee', 'bulk_import')
  )
  with check (
    initiated_by = app.current_employee_id()
    or app.has_permission_on_company(app.current_employee_id(), company_id, 'employee', 'bulk_import')
  );

create policy import_batch_rows_select on import_batch_rows for select
  using (batch_id in (select id from import_batches));

create policy import_batch_rows_insert on import_batch_rows for insert
  with check (batch_id in (select id from import_batches where initiated_by = app.current_employee_id()));

create policy import_batch_rows_update on import_batch_rows for update
  using (batch_id in (select id from import_batches where initiated_by = app.current_employee_id()))
  with check (batch_id in (select id from import_batches where initiated_by = app.current_employee_id()));
