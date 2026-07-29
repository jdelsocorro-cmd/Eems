-- ============================================================================
-- 005_goals_kpis.sql
-- Goals (OKR-style cascading alignment) and KPIs, with the fixes the original
-- design audit flagged: a direction field (higher/lower/exact is-better),
-- weight/target changes logged separately from routine value updates so
-- retroactive score manipulation is always visible, and a point-in-time
-- kpi_scores snapshot so a past period's score can't silently drift.
-- ============================================================================

create type goal_type as enum ('company', 'department', 'team', 'individual');
create type goal_status as enum ('draft', 'active', 'completed', 'archived');

create table goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  description text,
  goal_type goal_type not null,
  department_id uuid references departments(id),
  team_id uuid references teams(id),
  employee_id uuid references employees(id),
  parent_goal_id uuid references goals(id), -- cascading alignment: company -> dept -> team -> individual
  period_start date not null,
  period_end date not null,
  status goal_status not null default 'draft',
  created_by uuid references employees(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_goals_dates check (period_end >= period_start),
  -- Exactly one owning FK set, matching goal_type. Enforced by Postgres, not
  -- a polymorphic owner_type/owner_id pair, so referential integrity is real.
  constraint chk_goals_owner_matches_type check (
    (goal_type = 'company'    and department_id is null and team_id is null and employee_id is null) or
    (goal_type = 'department' and department_id is not null and team_id is null and employee_id is null) or
    (goal_type = 'team'       and department_id is null and team_id is not null and employee_id is null) or
    (goal_type = 'individual' and department_id is null and team_id is null and employee_id is not null)
  )
);

create trigger trg_goals_updated_at
  before update on goals
  for each row execute function app.set_updated_at();

create trigger trg_audit_goals
  after insert or update or delete on goals
  for each row execute function app.write_audit_log();

create index idx_goals_company on goals(company_id) where deleted_at is null;
create index idx_goals_parent on goals(parent_goal_id) where deleted_at is null;
create index idx_goals_employee on goals(employee_id) where deleted_at is null;

create type kpi_direction as enum ('higher_is_better', 'lower_is_better', 'target_is_exact');
create type kpi_status as enum ('active', 'completed', 'archived');

create table kpi_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id), -- null = global template
  name text not null,
  description text,
  unit text not null,
  direction kpi_direction not null,
  default_weight numeric(5,2) not null default 0 check (default_weight >= 0 and default_weight <= 100),
  applicable_scope_type text, -- 'company' | 'department' | 'team' | 'position', informational filter for the picker UI
  applicable_scope_id uuid,
  is_active boolean not null default true,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_kpi_templates_updated_at
  before update on kpi_templates
  for each row execute function app.set_updated_at();

create table kpis (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  goal_id uuid references goals(id),
  kpi_template_id uuid references kpi_templates(id),
  task_id uuid references tasks(id),
  name text not null,
  unit text not null,
  direction kpi_direction not null,
  target_value numeric not null,
  current_value numeric not null default 0,
  weight numeric(5,2) not null check (weight >= 0 and weight <= 100),
  period_start date not null,
  period_end date not null,
  status kpi_status not null default 'active',
  created_by uuid references employees(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_kpis_dates check (period_end >= period_start),
  -- target_value is the divisor for higher_is_better and target_is_exact
  -- (see app.compute_employee_score) -- must be nonzero for those directions.
  -- lower_is_better divides by current_value instead, so target_value=0 is a
  -- legitimate target there (e.g. "zero defects").
  constraint chk_kpis_target_nonzero check (
    direction = 'lower_is_better' or target_value <> 0
  )
);

create trigger trg_kpis_updated_at
  before update on kpis
  for each row execute function app.set_updated_at();

create index idx_kpis_employee on kpis(employee_id) where deleted_at is null;
create index idx_kpis_goal on kpis(goal_id) where deleted_at is null;
create index idx_kpis_period on kpis(employee_id, period_start, period_end) where deleted_at is null and status = 'active';

-- ----------------------------------------------------------------------------
-- kpi_value_history: routine value updates (frequent, low-stakes).
-- kpi_change_log: target/weight/direction/status changes (rare, high-stakes
-- -- this is what makes "someone quietly lowered their target after the
-- fact" always visible). Deliberately two separate tables/triggers, not one,
-- because they answer different audit questions.
-- ----------------------------------------------------------------------------
create table kpi_value_history (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references kpis(id),
  old_value numeric,
  new_value numeric not null,
  changed_by uuid references employees(id),
  changed_at timestamptz not null default now(),
  note text
);

create index idx_kpi_value_history_kpi on kpi_value_history(kpi_id);

create type kpi_change_field as enum ('target_value', 'weight', 'direction', 'status');

create table kpi_change_log (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references kpis(id),
  field_changed kpi_change_field not null,
  old_value text,
  new_value text,
  changed_by uuid references employees(id),
  changed_at timestamptz not null default now(),
  reason text
);

create index idx_kpi_change_log_kpi on kpi_change_log(kpi_id);

-- security definer: kpi_value_history and kpi_change_log have no direct
-- INSERT policy for authenticated/eems_app (006_rls_policies.sql) -- only
-- this trigger writes them, which is what makes the scoring-integrity trail
-- tamper-proof from the client side.
create or replace function app.log_kpi_changes()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT' then
    insert into kpi_value_history (kpi_id, old_value, new_value, changed_by)
    values (new.id, null, new.current_value, app.current_employee_id());
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.current_value is distinct from old.current_value then
      insert into kpi_value_history (kpi_id, old_value, new_value, changed_by)
      values (new.id, old.current_value, new.current_value, app.current_employee_id());
    end if;

    if new.target_value is distinct from old.target_value then
      insert into kpi_change_log (kpi_id, field_changed, old_value, new_value, changed_by)
      values (new.id, 'target_value', old.target_value::text, new.target_value::text, app.current_employee_id());
    end if;

    if new.weight is distinct from old.weight then
      insert into kpi_change_log (kpi_id, field_changed, old_value, new_value, changed_by)
      values (new.id, 'weight', old.weight::text, new.weight::text, app.current_employee_id());
    end if;

    if new.direction is distinct from old.direction then
      insert into kpi_change_log (kpi_id, field_changed, old_value, new_value, changed_by)
      values (new.id, 'direction', old.direction::text, new.direction::text, app.current_employee_id());
    end if;

    if new.status is distinct from old.status then
      insert into kpi_change_log (kpi_id, field_changed, old_value, new_value, changed_by)
      values (new.id, 'status', old.status::text, new.status::text, app.current_employee_id());
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_kpis_change_log
  after insert or update on kpis
  for each row execute function app.log_kpi_changes();

-- ----------------------------------------------------------------------------
-- Column-level authorization: logging the change (above) is necessary but
-- not sufficient -- an employee updating their own KPI's current_value
-- (routine progress logging) is very different from someone changing the
-- target/weight/direction after the fact (the scoring-integrity gap the
-- original design audit flagged). RLS policies apply to the whole row and
-- can't distinguish which columns changed, so this BEFORE trigger enforces
-- the finer-grained rule: target/weight/direction/status edits require the
-- 'kpi'/'update_target' permission scoped to the KPI's employee, even for
-- someone who otherwise has 'kpi'/'update_value' on their own row.
-- ----------------------------------------------------------------------------
create or replace function app.enforce_kpi_sensitive_changes()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if (new.target_value is distinct from old.target_value
      or new.weight is distinct from old.weight
      or new.direction is distinct from old.direction)
     and not app.has_permission_on_employee(app.current_employee_id(), old.employee_id, 'kpi', 'update_target') then
    raise exception 'Not authorized to change target/weight/direction on this KPI';
  end if;
  return new;
end;
$$;

create trigger trg_kpis_enforce_sensitive_changes
  before update on kpis
  for each row execute function app.enforce_kpi_sensitive_changes();

-- ----------------------------------------------------------------------------
-- kpi_scores: point-in-time snapshot. computed_score is NULL (never 0) when
-- an employee has zero active KPIs in the period -- the UI renders
-- "No active KPIs", not a misleading "0%".
-- ----------------------------------------------------------------------------
create type score_computed_by as enum ('system', 'manual');

create table kpi_scores (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  period_start date not null,
  period_end date not null,
  computed_score numeric(6,2), -- null = undefined (zero active KPIs), never coerced to 0
  kpi_snapshot jsonb not null, -- [{kpi_id, name, target_value, current_value, weight, direction}, ...] at computation time
  computed_at timestamptz not null default now(),
  computed_by score_computed_by not null default 'system'
);

create index idx_kpi_scores_employee_period on kpi_scores(employee_id, period_start, period_end);

-- app.compute_employee_score(employee_id, period_start, period_end)
-- Weight-normalized, direction-aware, divide-by-zero-safe. Returns NULL when
-- the employee has no active KPIs overlapping the period (sum of weights = 0)
-- rather than a misleading 0. Ratios are capped at 1.5x so a single wildly
-- over-achieved KPI can't dominate the weighted average.
create or replace function app.compute_employee_score(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date
)
returns numeric
language plpgsql
stable
as $$
declare
  v_total_weight numeric;
  v_weighted_sum numeric;
  v_cap constant numeric := 1.5;
begin
  select
    coalesce(sum(weight), 0),
    coalesce(sum(
      weight * (
        case direction
          when 'higher_is_better' then least(current_value / nullif(target_value, 0), v_cap)
          when 'lower_is_better' then
            case when current_value > 0 then least(target_value / current_value, v_cap) else 1.0 end
          when 'target_is_exact' then
            greatest(1 - least(abs(current_value - target_value) / nullif(target_value, 0), 1), 0)
        end
      )
    ), 0)
  into v_total_weight, v_weighted_sum
  from kpis
  where employee_id = p_employee_id
    and status = 'active'
    and deleted_at is null
    and period_start <= p_period_end
    and period_end >= p_period_start;

  if v_total_weight = 0 then
    return null;
  end if;

  return round((v_weighted_sum / v_total_weight) * 100, 2);
end;
$$;
