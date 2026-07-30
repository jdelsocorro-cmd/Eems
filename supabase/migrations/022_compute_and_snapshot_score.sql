-- ============================================================================
-- 022_compute_and_snapshot_score.sql
--
-- kpi_scores has no client INSERT policy by design (006) -- snapshots must
-- be system-written, not a row-level client write, so a past period's score
-- can't be forged or silently edited after the fact. This function is that
-- system write path: SECURITY DEFINER, owned by postgres (bypasses RLS on
-- kpi_scores the same way project_owner_id/project_company_id bypass RLS on
-- projects -- see 019/020), so it can insert into a table the caller has no
-- direct INSERT policy on at all.
--
-- Because SECURITY DEFINER functions are callable directly by any
-- authenticated caller (via SQL, or Realtime, which talks to Postgres
-- directly and bypasses FastAPI entirely -- the same reason RLS itself has
-- to be correct independent of the API layer), authorization is enforced
-- INSIDE the function, not left to the FastAPI route alone: computing a
-- score for someone else requires the same kpi/update_value or
-- kpi/update_target rights kpis_update already requires to touch that
-- employee's KPIs. This mirrors kpis_update's own OR-chain rather than
-- inventing a new permission.
-- ============================================================================

create or replace function app.compute_and_snapshot_score(
  p_employee_id uuid,
  p_period_start date,
  p_period_end date,
  p_computed_by score_computed_by default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_caller uuid := app.current_employee_id();
  v_score numeric;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_employee_id <> v_caller
     and not app.has_permission_on_employee(v_caller, p_employee_id, 'kpi', 'update_value')
     and not app.has_permission_on_employee(v_caller, p_employee_id, 'kpi', 'update_target') then
    raise exception 'Not authorized to compute a score for this employee';
  end if;

  v_score := app.compute_employee_score(p_employee_id, p_period_start, p_period_end);

  select coalesce(jsonb_agg(jsonb_build_object(
    'kpi_id', id, 'name', name, 'unit', unit, 'direction', direction,
    'target_value', target_value, 'current_value', current_value, 'weight', weight
  )), '[]'::jsonb)
  into v_snapshot
  from kpis
  where employee_id = p_employee_id
    and status = 'active'
    and deleted_at is null
    and period_start <= p_period_end
    and period_end >= p_period_start;

  insert into kpi_scores (employee_id, period_start, period_end, computed_score, kpi_snapshot, computed_by)
  values (p_employee_id, p_period_start, p_period_end, v_score, v_snapshot, p_computed_by)
  returning id into v_id;

  return v_id;
end;
$$;
