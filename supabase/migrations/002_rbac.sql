-- ============================================================================
-- 002_rbac.sql
-- permissions catalog, roles (admin-creatable, not fixed to 3), role_permissions,
-- employee_roles (scope lives on the GRANT, not the role), and the generic
-- audit_log trigger used across every RBAC/KPI-sensitive table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- permissions
-- Fixed catalog, seeded in 007_seed_permissions.sql. Not admin-editable in
-- Phase 1 -- it changes when a new module ships, not at runtime. What IS
-- admin-editable is which roles have which permissions (role_permissions)
-- and who holds which role at what scope (employee_roles).
-- ----------------------------------------------------------------------------
create table permissions (
  id uuid primary key default gen_random_uuid(),
  resource text not null,
  action text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (resource, action)
);

-- ----------------------------------------------------------------------------
-- roles
-- company_id null = system-defined template role (seeded), shared conceptually
-- across companies; company_id set = a role an admin created for their org.
-- ----------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_roles_updated_at
  before update on roles
  for each row execute function app.set_updated_at();

create unique index uq_roles_company_name on roles(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- ----------------------------------------------------------------------------
-- role_permissions
-- ----------------------------------------------------------------------------
create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- employee_roles
-- The actual grant. Scope lives HERE, not on the role, so the same role
-- ("Manager") can be granted to one person scoped to their position_subtree
-- and to another scoped to a whole department (e.g. an interim dept head)
-- without inventing role variants per scope.
-- ----------------------------------------------------------------------------
create type rbac_scope_type as enum ('company', 'department', 'team', 'position_subtree', 'self');

create table employee_roles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  role_id uuid not null references roles(id),
  scope_type rbac_scope_type not null,
  scope_id uuid, -- company_id / department_id / team_id / position_id depending on scope_type; null only valid for 'self'
  granted_by uuid references employees(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint chk_employee_roles_scope_id check (
    (scope_type = 'self' and scope_id is null)
    or (scope_type <> 'self' and scope_id is not null)
  )
);

-- Partial index predicates must be IMMUTABLE -- now() is only STABLE, so it
-- can't appear here. Indexing the common case (non-expiring grants) still
-- helps; the query itself adds `or expires_at > now()` on top, which falls
-- back to a normal (unindexed for that branch) filter -- acceptable at
-- Phase 1 scale, where most employees hold a handful of grants.
create index idx_employee_roles_employee on employee_roles(employee_id) where expires_at is null;
create index idx_employee_roles_role on employee_roles(role_id);

-- ----------------------------------------------------------------------------
-- audit_log
-- Generic, trigger-populated on every RBAC/KPI-sensitive table (attached in
-- the migrations that create those tables). This is the structured, complete,
-- append-only backbone that future BI/AI-copilot phases read from -- it's
-- built now specifically so those phases don't need a schema change later.
-- ----------------------------------------------------------------------------
create type audit_action as enum ('insert', 'update', 'delete');

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid, -- null for composite-key tables (e.g. role_permissions) -- old_data/new_data carry full row identity there
  action audit_action not null,
  actor_employee_id uuid references employees(id), -- null = system/job
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index idx_audit_log_table_record on audit_log(table_name, record_id);
create index idx_audit_log_occurred_at on audit_log(occurred_at);

-- security definer: audit_log has no INSERT policy for authenticated/eems_app
-- (006_rls_policies.sql) -- writes only ever happen through this trigger, so
-- a client can never fabricate or tamper with its own audit trail.
create or replace function app.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (table_name, record_id, action, actor_employee_id, new_data)
    values (tg_table_name, new.id, 'insert', app.current_employee_id(), to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into audit_log (table_name, record_id, action, actor_employee_id, old_data, new_data)
    values (tg_table_name, new.id, 'update', app.current_employee_id(), to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_log (table_name, record_id, action, actor_employee_id, old_data)
    values (tg_table_name, old.id, 'delete', app.current_employee_id(), to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

-- Composite-key variant for junction tables with no `id` column (role_permissions
-- has PK (role_id, permission_id)) -- write_audit_log() above assumes NEW.id/OLD.id
-- exist, which fails here. record_id is left null; old_data/new_data (which
-- always contain the full row, including both key columns) are what identify
-- the row for these tables.
create or replace function app.write_audit_log_composite_key()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (table_name, record_id, action, actor_employee_id, new_data)
    values (tg_table_name, null, 'insert', app.current_employee_id(), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into audit_log (table_name, record_id, action, actor_employee_id, old_data)
    values (tg_table_name, null, 'delete', app.current_employee_id(), to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

-- Attach audit logging to the RBAC tables themselves (grants/roles changing
-- is exactly the kind of event that needs a trail).
create trigger trg_audit_roles
  after insert or update or delete on roles
  for each row execute function app.write_audit_log();

create trigger trg_audit_role_permissions
  after insert or delete on role_permissions
  for each row execute function app.write_audit_log_composite_key();

create trigger trg_audit_employee_roles
  after insert or update or delete on employee_roles
  for each row execute function app.write_audit_log();

create trigger trg_audit_employees
  after insert or update or delete on employees
  for each row execute function app.write_audit_log();

create trigger trg_audit_positions
  after insert or update or delete on positions
  for each row execute function app.write_audit_log();
