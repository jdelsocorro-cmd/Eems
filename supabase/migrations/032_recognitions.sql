-- ============================================================================
-- 032_recognitions.sql
--
-- Recognition is always manually given (never auto-created) -- per Jayson's
-- confirmation, the completion-approval flow only ever *suggests* it via a
-- dismissible prompt when a score crosses recognition_score_threshold; the
-- INSERT itself is a deliberate human action every time, so there's no
-- system/trigger-written path here the way kpi_scores or task_status_history
-- are system-only. Low-friction by design (no permission gate to give one),
-- matching how task creation itself has none -- recognizing a colleague
-- should be as easy as assigning them a task.
-- ============================================================================

alter table companies add column recognition_score_threshold numeric(5,2) not null default 90;

-- related_entity_type is a proper enum (fixed vocabulary, matches every
-- other status/type column in this schema); category is deliberately left
-- as free text, not an enum -- recognition categories are the kind of
-- open-ended, company-specific vocabulary org_units.unit_type and
-- kpis.unit already treat as text rather than a fixed list, since
-- companies will reasonably want their own labels here over time.
create type recognition_related_entity_type as enum ('task', 'project', 'milestone', 'kpi');

create table recognitions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  given_by uuid not null references employees(id),
  category text not null default 'kudos',
  message text not null,
  related_entity_type recognition_related_entity_type,
  related_entity_id uuid,
  created_at timestamptz not null default now()
);

create index idx_recognitions_employee on recognitions(employee_id);

alter table recognitions enable row level security;

-- Visible to the recipient, the giver, and anyone who could already see the
-- recipient via the standard subtree-visibility rule every other
-- employee-scoped table in this schema uses -- this is what makes
-- "recorded... for future performance reviews" actually reviewable by a
-- manager, not just by the two people directly involved.
create policy recognitions_select on recognitions for select
  using (
    employee_id = app.current_employee_id()
    or given_by = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

-- Anyone can recognize anyone in a company they belong to -- no permission
-- gate, same low-friction reasoning as tasks_insert. Company membership
-- (not subtree) is the only check, since recognition is meant to work
-- across teams, not just within a direct reporting line.
create policy recognitions_insert on recognitions for insert
  with check (
    given_by = app.current_employee_id()
    and exists (
      select 1
      from position_assignments pa
      join positions p on p.id = pa.position_id
      join org_units ou on ou.id = p.org_unit_id
      where pa.employee_id = recognitions.employee_id
        and pa.end_date is null and pa.is_primary
        and ou.company_id in (select app.employee_accessible_company_ids(app.current_employee_id()))
    )
  );

create trigger trg_audit_recognitions
  after insert or update or delete on recognitions
  for each row execute function app.write_audit_log();
