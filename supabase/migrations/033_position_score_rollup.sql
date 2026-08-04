-- ============================================================================
-- 033_position_score_rollup.sql
--
-- The recursive weighted rollup: every leader's score reflects their whole
-- subtree transitively, not the flat org_unit_closure average
-- dashboards.py already computes (024_org_units.sql's comment is explicit
-- that flat averaging is what THAT rollup is for -- this is a different,
-- complementary view, not a replacement).
--
-- position_closure only gets walked *downward* everywhere else in this
-- schema (subtree queries). This function is the first thing that needs
-- the upward-implied ordering: process positions leaves-first, using each
-- position's own max-subtree-depth (how many levels report up through it,
-- at most) as the processing order, so by the time a manager's row is
-- computed every direct report underneath it already has a fresh value in
-- the working table. "Equal weight per direct report" (Jayson's choice)
-- means the position's own individual score and each direct report's
-- already-computed score are all equally-weighted items in one average --
-- not a 50/50 split between "me" and "my reports as a blob".
--
-- position_scores mirrors kpi_scores exactly: append-only snapshot, no
-- client INSERT policy, system-written only via this SECURITY DEFINER
-- function, triggered on-demand (POST /scores/compute-rollup) rather than
-- automatically -- same manual-trigger UX as My Scorecard's existing
-- "Compute score for period" button.
-- ============================================================================

create table position_scores (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions(id),
  period_start date not null,
  period_end date not null,
  computed_score numeric(6,2),
  computed_at timestamptz not null default now()
);

create index idx_position_scores_position on position_scores(position_id, computed_at desc);

alter table position_scores enable row level security;

-- No INSERT policy at all -- same as kpi_scores, the only writer is the
-- SECURITY DEFINER function below.
create policy position_scores_select on position_scores for select
  using (
    exists (
      select 1 from positions p
      join org_units ou on ou.id = p.org_unit_id
      where p.id = position_scores.position_id
        and ou.company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

create or replace function app.compute_and_snapshot_position_score(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_caller uuid := app.current_employee_id();
  v_position record;
  v_own_score numeric;
  v_report_scores numeric[];
  v_components numeric[];
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  -- Reuses dashboard.view_executive rather than inventing a new permission
  -- -- computing a company-wide rollup is the same authorization tier as
  -- viewing the executive dashboard.
  if not app.has_permission_on_company(v_caller, p_company_id, 'dashboard', 'view_executive') then
    raise exception 'Not authorized to compute rollup scores for this company';
  end if;

  create temporary table if not exists tmp_position_effective_scores (
    position_id uuid primary key,
    effective_score numeric
  ) on commit drop;

  delete from tmp_position_effective_scores;

  for v_position in
    select p.id as position_id, coalesce(max(pc.depth), 0) as max_subtree_depth
    from positions p
    join org_units ou on ou.id = p.org_unit_id
    left join position_closure pc on pc.ancestor_position_id = p.id
    where ou.company_id = p_company_id and p.deleted_at is null
    group by p.id
    order by max_subtree_depth asc
  loop
    v_own_score := null;
    v_components := array[]::numeric[];

    select ks.computed_score into v_own_score
    from position_assignments pa
    join kpi_scores ks on ks.employee_id = pa.employee_id
    where pa.position_id = v_position.position_id
      and pa.end_date is null and pa.is_primary
      and ks.period_start = p_period_start and ks.period_end = p_period_end
    order by ks.computed_at desc
    limit 1;

    if v_own_score is not null then
      v_components := array_append(v_components, v_own_score);
    end if;

    select array_agg(t.effective_score) into v_report_scores
    from positions rp
    join tmp_position_effective_scores t on t.position_id = rp.id
    where rp.reports_to_position_id = v_position.position_id
      and rp.deleted_at is null
      and t.effective_score is not null;

    if v_report_scores is not null then
      v_components := v_components || v_report_scores;
    end if;

    insert into tmp_position_effective_scores (position_id, effective_score)
    values (
      v_position.position_id,
      case when array_length(v_components, 1) is null then null
           else (select avg(x) from unnest(v_components) as x) end
    );
  end loop;

  insert into position_scores (position_id, period_start, period_end, computed_score)
  select position_id, p_period_start, p_period_end, round(effective_score, 2)
  from tmp_position_effective_scores;
end;
$$;
