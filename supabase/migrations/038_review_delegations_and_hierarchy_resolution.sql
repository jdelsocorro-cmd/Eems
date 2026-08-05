-- ============================================================================
-- 038_review_delegations_and_hierarchy_resolution.sql
--
-- Review eligibility today is 100% driven by manual employee_roles grants
-- (has_permission_on_employee) -- nothing connects "who reports to whom"
-- (the real org chart) to "who reviews this person's work". As more real
-- employees get loaded, every single one needs a correctly-scoped manual
-- grant or their work sits unreviewable, silently, the same way a real
-- task did before this migration (see 037_block_self_approval.sql's
-- context comment).
--
-- Per Jayson's explicit direction: default reviewer = immediate manager,
-- climbing to the next ancestor position on vacancy (which naturally
-- passes through Dept Head / Division Head / etc without hardcoding role
-- names -- they're just higher positions in the same tree), falling back
-- to any company-wide completion.review holder only once the whole chain
-- is vacant. Delegation and acting managers work without any new RBAC
-- grant. This is ADDITIVE to the existing grant-based path, not a
-- replacement -- anyone already correctly granted keeps working exactly
-- as today.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- review_delegations
-- The one genuinely new concept here. "Acting manager" needs zero new schema
-- -- position_assignments.assignment_type already has 'acting'/'interim'
-- (001_org_hierarchy.sql), and "current holder of a position" doesn't care
-- which type it is, so a hierarchy walk already finds an acting manager for
-- free. Delegation is different: a manager temporarily lending their review
-- authority to someone who may not even be in their reporting chain.
-- Additive, not exclusive -- both the delegator and delegate can review
-- while a delegation is active, since delegating doesn't mean the manager
-- is unreachable, just that someone else can also act.
-- ----------------------------------------------------------------------------
create table review_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_employee_id uuid not null references employees(id),
  delegate_employee_id uuid not null references employees(id),
  start_date date not null default current_date,
  end_date date,
  reason text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint chk_review_delegations_not_self check (delegator_employee_id <> delegate_employee_id)
);

create index idx_review_delegations_delegator on review_delegations(delegator_employee_id) where revoked_at is null;
create index idx_review_delegations_delegate on review_delegations(delegate_employee_id) where revoked_at is null;

alter table review_delegations enable row level security;

-- Visible to either party, or an admin (role.manage) for oversight -- same
-- "self or role.manage" shape employee_roles_select already uses
-- (006_rls_policies.sql:197-201).
create policy review_delegations_select on review_delegations for select
  using (
    delegator_employee_id = app.current_employee_id()
    or delegate_employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'role', 'manage')
  );

-- Low-friction, no permission gate -- same "you can only act on your own
-- record" reasoning recognitions_insert (032_recognitions.sql) already uses
-- for given_by. You can only ever lend out YOUR OWN authority.
create policy review_delegations_insert on review_delegations for insert
  with check (delegator_employee_id = app.current_employee_id());

-- Revoke (the only mutation besides insert) -- deliberately narrower than
-- select (a delegate can SEE a delegation naming them but can't revoke it
-- themselves, only the delegator or an admin can). The backend uses
-- RETURNING-then-check against this, same asymmetry class as
-- completion_submissions_select vs. _review.
create policy review_delegations_revoke on review_delegations for update
  using (
    delegator_employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'role', 'manage')
  )
  with check (revoked_at is not null);

create trigger trg_audit_review_delegations
  after insert or update or delete on review_delegations
  for each row execute function app.write_audit_log();

-- ----------------------------------------------------------------------------
-- app.is_eligible_completion_reviewer
-- The whole resolution mechanism in one function, callable from both the
-- completion_submissions_review RLS policy and the backend's
-- awaiting_my_review query filter, so "who can approve this" and "what
-- shows up in their review queue" can never drift apart.
-- ----------------------------------------------------------------------------
create or replace function app.is_eligible_completion_reviewer(
  p_employee_id uuid,
  p_entity_type completion_entity_type,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  v_responsible_id uuid;
  v_position_id uuid;
  v_ancestor_position_id uuid;
  v_holder_id uuid;
  v_company_id uuid;
begin
  -- 1. Resolve the responsible employee (task assignee / project or
  -- milestone owner) -- same lookup completion_workflow.get_responsible_
  -- employee_id() does in Python, expressed here in SQL since this runs
  -- inside RLS.
  if p_entity_type = 'task' then
    select assignee_employee_id into v_responsible_id from tasks where id = p_entity_id;
  elsif p_entity_type = 'project' then
    select owner_employee_id into v_responsible_id from projects where id = p_entity_id;
  else
    select p.owner_employee_id into v_responsible_id
      from milestones m join projects p on p.id = m.project_id where m.id = p_entity_id;
  end if;

  if v_responsible_id is null then
    return false;
  end if;

  select pa.position_id into v_position_id
    from position_assignments pa
    where pa.employee_id = v_responsible_id and pa.end_date is null and pa.is_primary;

  -- 2. Climb position_closure upward (nearest ancestor first). Stop at the
  -- FIRST occupied ancestor position -- that position's current holder
  -- (permanent or acting/interim, "current" doesn't distinguish) is the
  -- resolved default reviewer, or anyone they've actively delegated to.
  -- A vacant position is skipped (climb continues to the next ancestor,
  -- naturally passing through Dept Head / Division Head / etc without
  -- needing to know their titles); an OCCUPIED position that doesn't match
  -- p_employee_id stops the climb entirely -- their manager existing and
  -- being someone else doesn't mean go ask the manager's manager.
  if v_position_id is not null then
    for v_ancestor_position_id in
      select pc.ancestor_position_id
        from position_closure pc
        where pc.descendant_position_id = v_position_id and pc.depth > 0
        order by pc.depth asc
    loop
      select pa.employee_id into v_holder_id
        from position_assignments pa
        where pa.position_id = v_ancestor_position_id and pa.end_date is null and pa.is_primary;

      if v_holder_id is not null then
        return v_holder_id = p_employee_id or exists (
          select 1 from review_delegations rd
          where rd.delegator_employee_id = v_holder_id
            and rd.delegate_employee_id = p_employee_id
            and rd.revoked_at is null
            and current_date >= rd.start_date
            and (rd.end_date is null or current_date <= rd.end_date)
        );
      end if;
      -- vacant: fall through to the next iteration (next ancestor up)
    end loop;
  end if;

  -- 3. Whole chain vacant (or the responsible employee has no position at
  -- all): fall back to any employee holding completion.review at a scope
  -- reaching this company. This tier only fires once there is truly
  -- nobody occupying any position in the chain.
  v_company_id := app.employee_current_company_id(v_responsible_id);
  return v_company_id is not null
    and app.has_permission_on_company(p_employee_id, v_company_id, 'completion', 'review');
end;
$$;

-- ----------------------------------------------------------------------------
-- completion_submissions_review: additive OR branch. Every existing
-- grant-based path (task assigner, has_permission_on_employee for all
-- three entity types) is unchanged -- this only adds reviewers who weren't
-- previously eligible.
-- ----------------------------------------------------------------------------
drop policy completion_submissions_review on completion_submissions;
create policy completion_submissions_review on completion_submissions for update
  using (
    status = 'pending'
    and submitted_by <> app.current_employee_id()
    and (
      (entity_type = 'task' and exists (
        select 1 from tasks t where t.id = entity_id
          and (t.assigner_employee_id = app.current_employee_id()
               or app.has_permission_on_employee(app.current_employee_id(), t.assignee_employee_id, 'completion', 'review'))
      ))
      or (entity_type = 'project' and exists (
        select 1 from projects p where p.id = entity_id
          and app.has_permission_on_employee(app.current_employee_id(), p.owner_employee_id, 'completion', 'review')
      ))
      or (entity_type = 'milestone' and exists (
        select 1 from milestones m join projects p on p.id = m.project_id where m.id = entity_id
          and app.has_permission_on_employee(app.current_employee_id(), p.owner_employee_id, 'completion', 'review')
      ))
      or app.is_eligible_completion_reviewer(app.current_employee_id(), entity_type, entity_id)
    )
  )
  with check (
    reviewed_by = app.current_employee_id()
    and status in ('approved', 'rejected')
  );
