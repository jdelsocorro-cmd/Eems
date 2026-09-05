-- ============================================================================
-- 050_lock_hierarchy_closure_maintenance.sql
--
-- Production readiness review (2026-09-05) found app.maintain_position_
-- closure() and app.maintain_org_unit_closure() do a read-then-delete-then-
-- insert against the shared closure table with no locking at all -- under
-- Postgres's default READ COMMITTED, two concurrent reparents that touch
-- positions/org_units in an ancestor/descendant relationship (e.g. two
-- admins editing the Org Chart at overlapping moments, or a manual reorg
-- overlapping a bulk-import position assignment) can each compute their
-- delete/insert from a stale pre-transaction snapshot of the closure
-- table, silently corrupting it -- a subtree branch dropped, or a
-- reports-to relationship still resolving after it shouldn't. This is the
-- same closure-table corruption class that hit production via a manual
-- script earlier today, except reachable from the live app by ordinary
-- concurrent usage, not just a misbehaving script.
--
-- Fix: take a transaction-scoped advisory lock, one per closure table, at
-- the top of every branch that reads or writes it. This serializes ALL
-- reparents of a given type (position or org_unit) against each other --
-- not just overlapping subtrees -- which is a deliberately blunt but
-- simple and correct choice: reparenting is a rare, human-driven action
-- (an org restructure), never a hot path, so global serialization costs
-- nothing in practice while being trivially easy to reason about. A
-- narrower per-subtree lock key would need to correctly identify every
-- affected row before taking the lock -- exactly the kind of subtle logic
-- that produced the original corruption -- for no real performance
-- benefit at this scale. pg_advisory_xact_lock is released automatically
-- at transaction end (commit or rollback), so there's no unlock path to
-- forget and no risk of an orphaned lock surviving a crashed connection.
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
  perform pg_advisory_xact_lock(hashtext('position_closure'));

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

create or replace function app.maintain_org_unit_closure()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  would_cycle boolean;
begin
  perform pg_advisory_xact_lock(hashtext('org_unit_closure'));

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
