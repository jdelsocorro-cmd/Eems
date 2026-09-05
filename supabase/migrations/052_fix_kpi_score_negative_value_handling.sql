-- ============================================================================
-- 052_fix_kpi_score_negative_value_handling.sql
--
-- Production readiness review (2026-09-05) found app.compute_employee_score
-- (005_goals_kpis.sql) has no floor for negative current_value on two of
-- three directions:
--   - lower_is_better: `case when current_value > 0 then ... else 1.0 end`
--     scores ANY non-positive current_value as a perfect 1.0 -- correct for
--     current_value = 0 (a real target, "zero defects"), but wrong for a
--     negative value like "-5 defects" (a data-entry error, not a real
--     result), which should never be able to look like flawless
--     performance.
--   - higher_is_better: `least(current_value / target_value, cap)` has no
--     floor at all -- a negative current_value produces a negative ratio,
--     dragging the whole weighted-average score below 0%, a percentage
--     with no business meaning (target_is_exact already floors at 0;
--     these two never did).
--
-- Root cause: nothing in the schema prevented kpis.current_value from
-- being negative in the first place -- no KPI direction has a legitimate
-- negative value (you can't have -5 sales, -3 defects, or -2 hours), so
-- this closes the gap at the source with a CHECK constraint rather than
-- only working around it in the scoring formula. Existing rows are
-- clamped to 0 first (extremely unlikely any exist -- the app has never
-- exposed a UI path to enter a negative value -- but a migration adding a
-- CHECK to an existing table must not fail against unexpected data).
-- With the constraint in place, current_value can never be negative going
-- forward, so the formula is simplified accordingly rather than kept
-- defensive against a case that can no longer occur.
-- ============================================================================

update kpis set current_value = 0 where current_value < 0;

alter table kpis add constraint chk_kpis_current_value_nonnegative check (current_value >= 0);

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
          when 'higher_is_better' then greatest(least(current_value / nullif(target_value, 0), v_cap), 0)
          when 'lower_is_better' then
            case when current_value = 0 then 1.0 else least(target_value / current_value, v_cap) end
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
