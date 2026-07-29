-- ============================================================================
-- 009_position_reparent_reason.sql
-- Lets the API pass a human-readable reason through to
-- position_hierarchy_history at reparent time, via a session-level config
-- var the same way RLS already reads request.jwt.claims -- the trigger
-- itself doesn't change shape, just picks up an optional extra value.
-- ============================================================================

create or replace function app.maintain_position_closure()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  would_cycle boolean;
begin
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

    delete from position_closure
    where descendant_position_id in (
      select descendant_position_id from position_closure where ancestor_position_id = new.id
    )
    and ancestor_position_id in (
      select ancestor_position_id from position_closure where descendant_position_id = new.id and ancestor_position_id <> descendant_position_id
    );

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

    insert into position_hierarchy_history (position_id, old_reports_to_position_id, new_reports_to_position_id, changed_by, reason)
    values (
      new.id,
      old.reports_to_position_id,
      new.reports_to_position_id,
      app.current_employee_id(),
      nullif(current_setting('app.reparent_reason', true), '')
    );

    return new;
  end if;

  return new;
end;
$$;
