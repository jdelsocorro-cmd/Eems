-- ============================================================================
-- 024_org_units.sql
--
-- Replaces the fixed Company -> Department -> Team -> Position hierarchy
-- with a self-referencing org_units table of arbitrary depth, generalizing
-- the exact pattern positions/position_closure already use for reporting
-- lines one level up, to the containers themselves.
--
-- Why: the fixed 4-level schema assumed every company subdivides the same
-- way (department, then team, then position). Real org charts don't --
-- some departments go straight to individual contributors (no team layer),
-- others nest deeper (division -> department -> team -> pod). Forcing every
-- company into the same fixed depth means either inventing throwaway
-- placeholder teams for flat departments, or being unable to represent a
-- deeper structure at all. org_units fixes this at the schema level instead
-- of working around it in the UI.
--
-- unit_type is free text, not an enum -- it's a display label ("Division",
-- "Department", "Team", "Pod", whatever the company actually calls it), not
-- a constraint the hierarchy engine depends on. Permissions, KPI rollups,
-- and dashboards work off org_unit_closure (depth-agnostic), never off
-- unit_type or a fixed level count.
-- ============================================================================

create table org_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  parent_unit_id uuid references org_units(id),
  unit_type text not null default 'department',
  name text not null,
  code text,
  description text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_org_units_no_self_parent check (parent_unit_id is distinct from id)
);

create trigger trg_org_units_updated_at
  before update on org_units
  for each row execute function app.set_updated_at();

create index idx_org_units_company on org_units(company_id) where deleted_at is null;
create index idx_org_units_parent on org_units(parent_unit_id) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- org_unit_closure: transitive closure over org_units.parent_unit_id.
-- Same shape and purpose as position_closure -- "everyone/everything under
-- unit X" becomes an indexed lookup regardless of how many levels are
-- nested under X, instead of a recursive walk re-run on every query.
-- ----------------------------------------------------------------------------
create table org_unit_closure (
  ancestor_unit_id uuid not null references org_units(id),
  descendant_unit_id uuid not null references org_units(id),
  depth int not null,
  primary key (ancestor_unit_id, descendant_unit_id)
);

create index idx_org_unit_closure_descendant on org_unit_closure(descendant_unit_id);
create index idx_org_unit_closure_ancestor on org_unit_closure(ancestor_unit_id);

-- ----------------------------------------------------------------------------
-- org_unit_hierarchy_history: every reparent event, ever -- same guarantee
-- position_hierarchy_history gives positions. Populated by the same trigger
-- that maintains org_unit_closure, so a reorg without a record is
-- structurally impossible, matching the audit-trail requirement the
-- original design review flagged for position reparenting.
-- ----------------------------------------------------------------------------
create table org_unit_hierarchy_history (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id),
  old_parent_unit_id uuid references org_units(id),
  new_parent_unit_id uuid references org_units(id),
  changed_by uuid references employees(id),
  changed_at timestamptz not null default now(),
  reason text
);

create index idx_org_unit_hierarchy_history_unit on org_unit_hierarchy_history(org_unit_id);

-- security definer: writes org_unit_closure/org_unit_hierarchy_history on
-- behalf of whichever role updated org_units. Those tables get no direct
-- INSERT policy for authenticated/eems_app (see policies below) -- this
-- trigger is the only writer, same append-only-via-trigger guarantee
-- app.maintain_position_closure() gives positions.
create or replace function app.maintain_org_unit_closure()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  would_cycle boolean;
begin
  if tg_op = 'INSERT' then
    insert into org_unit_closure (ancestor_unit_id, descendant_unit_id, depth)
    values (new.id, new.id, 0);

    if new.parent_unit_id is not null then
      insert into org_unit_closure (ancestor_unit_id, descendant_unit_id, depth)
      select anc.ancestor_unit_id, new.id, anc.depth + 1
      from org_unit_closure anc
      where anc.descendant_unit_id = new.parent_unit_id;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' and new.parent_unit_id is distinct from old.parent_unit_id then

    if new.parent_unit_id is not null then
      select exists (
        select 1 from org_unit_closure
        where ancestor_unit_id = new.id
          and descendant_unit_id = new.parent_unit_id
      ) into would_cycle;

      if would_cycle then
        raise exception 'Reparenting org unit % under % would create a cycle', new.id, new.parent_unit_id;
      end if;
    end if;

    delete from org_unit_closure
    where descendant_unit_id in (
      select descendant_unit_id from org_unit_closure where ancestor_unit_id = new.id
    )
    and ancestor_unit_id in (
      select ancestor_unit_id from org_unit_closure where descendant_unit_id = new.id and ancestor_unit_id <> descendant_unit_id
    );

    if new.parent_unit_id is not null then
      insert into org_unit_closure (ancestor_unit_id, descendant_unit_id, depth)
      select anc.ancestor_unit_id, desc_rows.descendant_unit_id,
             anc.depth + 1 + desc_rows.depth
      from org_unit_closure anc
      cross join (
        select descendant_unit_id, depth
        from org_unit_closure
        where ancestor_unit_id = new.id
      ) desc_rows
      where anc.descendant_unit_id = new.parent_unit_id;
    end if;

    insert into org_unit_hierarchy_history (org_unit_id, old_parent_unit_id, new_parent_unit_id, changed_by, reason)
    values (new.id, old.parent_unit_id, new.parent_unit_id, app.current_employee_id(), nullif(current_setting('app.reparent_reason', true), ''));

    return new;
  end if;

  return new;
end;
$$;

create trigger trg_org_units_closure
  after insert or update on org_units
  for each row execute function app.maintain_org_unit_closure();

create trigger trg_audit_org_units
  after insert or update or delete on org_units
  for each row execute function app.write_audit_log();

-- ----------------------------------------------------------------------------
-- RLS: same visibility/mutation model companies/departments/teams already
-- used -- structural data, readable company-wide, mutation gated by
-- org_structure.manage scoped to the unit's own company (app.
-- has_permission_on_company(), 013_scope_aware_org_structure_mutate.sql).
-- ----------------------------------------------------------------------------
alter table org_units enable row level security;
alter table org_unit_closure enable row level security;
alter table org_unit_hierarchy_history enable row level security;

create policy org_units_select on org_units for select
  using (company_id in (select app.employee_accessible_company_ids(app.current_employee_id())));

create policy org_units_mutate on org_units for all
  using (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'))
  with check (app.has_permission_on_company(app.current_employee_id(), company_id, 'org_structure', 'manage'));

create policy org_unit_closure_select on org_unit_closure for select
  using (
    ancestor_unit_id in (
      select id from org_units where company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

create policy org_unit_hierarchy_history_select on org_unit_hierarchy_history for select
  using (
    org_unit_id in (
      select id from org_units where company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );
