-- ============================================================================
-- 001_org_hierarchy.sql
-- Company -> Department -> Team -> Position hierarchy, Employees, and the
-- position_closure / position_hierarchy_history tables that make subtree
-- authorization and reorg audit trails real mechanisms, not principles.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- Generic updated_at trigger, reused by every table below and in later migrations.
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- companies
-- ----------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_companies_updated_at
  before update on companies
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------------
-- departments
-- ----------------------------------------------------------------------------
create table departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  code text not null,
  description text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create trigger trg_departments_updated_at
  before update on departments
  for each row execute function app.set_updated_at();

create index idx_departments_company on departments(company_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- teams
-- ----------------------------------------------------------------------------
create table teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  name text not null,
  code text not null,
  description text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, code)
);

create trigger trg_teams_updated_at
  before update on teams
  for each row execute function app.set_updated_at();

create index idx_teams_department on teams(department_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- positions
-- A Position is a seat in the org chart, not a person. The reporting line
-- lives here (reports_to_position_id), never on employees, because reorgs
-- move seats, not people.
-- ----------------------------------------------------------------------------
create type employment_type as enum ('full_time', 'part_time', 'contractor');

create table positions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  title text not null,
  code text not null,
  reports_to_position_id uuid references positions(id),
  seniority_level int not null default 0,
  employment_type employment_type not null default 'full_time',
  headcount_cap int not null default 1,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, code),
  constraint chk_positions_no_self_report check (reports_to_position_id is distinct from id)
);

create trigger trg_positions_updated_at
  before update on positions
  for each row execute function app.set_updated_at();

create index idx_positions_team on positions(team_id) where deleted_at is null;
create index idx_positions_reports_to on positions(reports_to_position_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- position_closure
-- Transitive closure over positions.reports_to_position_id. Includes
-- self-rows at depth 0. This is what turns "is X in Y's subtree" into an
-- indexed EXISTS instead of a recursive CTE re-walked on every RLS check.
-- Maintained entirely by trigger below -- never written to directly.
-- ----------------------------------------------------------------------------
create table position_closure (
  ancestor_position_id uuid not null references positions(id),
  descendant_position_id uuid not null references positions(id),
  depth int not null,
  primary key (ancestor_position_id, descendant_position_id)
);

create index idx_position_closure_descendant on position_closure(descendant_position_id);
create index idx_position_closure_ancestor on position_closure(ancestor_position_id);

-- ----------------------------------------------------------------------------
-- position_hierarchy_history
-- Every reparent event, ever. Populated by the same trigger that maintains
-- position_closure, so a reparent without a record is structurally impossible.
-- ----------------------------------------------------------------------------
create table position_hierarchy_history (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id),
  old_reports_to_position_id uuid references positions(id),
  new_reports_to_position_id uuid references positions(id),
  changed_by uuid, -- references employees(id); FK added in 002 after employees exists
  changed_at timestamptz not null default now(),
  reason text
);

create index idx_position_hierarchy_history_position on position_hierarchy_history(position_id);

-- ----------------------------------------------------------------------------
-- Closure maintenance + cycle prevention + history logging, all in one
-- trigger so they're atomic with the structural change.
-- ----------------------------------------------------------------------------
-- security definer: this trigger writes to position_closure and
-- position_hierarchy_history on behalf of whichever role updated positions.
-- Those tables have no direct INSERT policy for authenticated/eems_app (see
-- 006_rls_policies.sql) -- the ONLY way rows get written to them is through
-- this trigger, which is exactly the append-only-via-trigger guarantee we
-- want for an audit trail.
create or replace function app.maintain_position_closure()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  would_cycle boolean;
begin
  -- INSERT: seed self-row, then splice in under the new parent's ancestors (if any).
  if tg_op = 'INSERT' then
    insert into position_closure (ancestor_position_id, descendant_position_id, depth)
    values (new.id, new.id, 0);

    if new.reports_to_position_id is not null then
      insert into position_closure (ancestor_position_id, descendant_position_id, depth)
      select anc.ancestor_position_id, new.id, anc.depth + 1
      from position_closure anc
      where anc.descendant_position_id = new.reports_to_position_id;
    end if;

    return new;
  end if;

  -- UPDATE of reports_to_position_id: rebuild the affected subtree's ancestor links.
  if tg_op = 'UPDATE' and new.reports_to_position_id is distinct from old.reports_to_position_id then

    if new.reports_to_position_id is not null then
      select exists (
        select 1 from position_closure
        where ancestor_position_id = new.id
          and descendant_position_id = new.reports_to_position_id
      ) into would_cycle;

      if would_cycle then
        raise exception 'Reparenting position % under % would create a cycle', new.id, new.reports_to_position_id;
      end if;
    end if;

    -- Remove all (ancestor-of-old-tree) x (this node + its descendants) links,
    -- except self-rows, which never change.
    delete from position_closure
    where descendant_position_id in (
      select descendant_position_id from position_closure where ancestor_position_id = new.id
    )
    and ancestor_position_id in (
      select ancestor_position_id from position_closure where descendant_position_id = new.id and ancestor_position_id <> descendant_position_id
    );

    -- Re-attach this node's whole subtree under the new parent's ancestor chain.
    if new.reports_to_position_id is not null then
      insert into position_closure (ancestor_position_id, descendant_position_id, depth)
      select anc.ancestor_position_id, desc_rows.descendant_position_id,
             anc.depth + 1 + desc_rows.depth
      from position_closure anc
      cross join (
        select descendant_position_id, depth
        from position_closure
        where ancestor_position_id = new.id
      ) desc_rows
      where anc.descendant_position_id = new.reports_to_position_id;
    end if;

    insert into position_hierarchy_history (position_id, old_reports_to_position_id, new_reports_to_position_id, changed_by)
    values (new.id, old.reports_to_position_id, new.reports_to_position_id, app.current_employee_id());

    return new;
  end if;

  return new;
end;
$$;

create trigger trg_positions_closure
  after insert or update on positions
  for each row execute function app.maintain_position_closure();

-- ----------------------------------------------------------------------------
-- employees
-- Never stores a position or manager directly -- see position_assignments.
-- ----------------------------------------------------------------------------
create type employee_status as enum ('active', 'on_leave', 'offboarded');

create table employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id),
  employee_number text unique,
  first_name text not null,
  last_name text not null,
  work_email text not null unique,
  personal_email text,
  phone text,
  avatar_url text,
  hire_date date,
  termination_date date,
  status employee_status not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_employees_updated_at
  before update on employees
  for each row execute function app.set_updated_at();

create index idx_employees_auth_user on employees(auth_user_id);
create index idx_employees_status on employees(status) where deleted_at is null;

alter table position_hierarchy_history
  add constraint fk_position_hierarchy_history_changed_by
  foreign key (changed_by) references employees(id);

-- app.current_employee_id() resolves the calling session's JWT (auth.uid())
-- to an employees.id. Defined here, right after employees exists, because the
-- closure-maintenance trigger above already calls it, and every RBAC/RLS
-- function in later migrations depends on it too. stable + security definer
-- so it can be used freely inside RLS policies without extra grants.
create or replace function app.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select id from employees where auth_user_id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- position_assignments
-- Employee-to-position history. "Current position" = row with end_date null.
-- This table *is* the employee-side hierarchy history (who held what seat,
-- when) -- re-parenting a position never needs to touch this table at all,
-- since the position keeps its assignment and the position moved, not the
-- person.
-- ----------------------------------------------------------------------------
create type assignment_type as enum ('permanent', 'acting', 'interim');

create table position_assignments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id),
  employee_id uuid not null references employees(id),
  start_date date not null default current_date,
  end_date date,
  assignment_type assignment_type not null default 'permanent',
  is_primary boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  constraint chk_position_assignments_dates check (end_date is null or end_date >= start_date)
);

create index idx_position_assignments_position on position_assignments(position_id);
create index idx_position_assignments_employee on position_assignments(employee_id);

-- Only one current (end_date is null) primary holder per position at a time.
create unique index uq_position_assignments_current_primary
  on position_assignments(position_id)
  where end_date is null and is_primary;

-- Only one current position per employee (an employee occupies one seat at a
-- time in Phase 1 -- dual-hat via is_primary=false on a second concurrent row
-- is schema-legal but not surfaced in Phase 1 UI).
create unique index uq_position_assignments_current_employee
  on position_assignments(employee_id)
  where end_date is null and is_primary;
