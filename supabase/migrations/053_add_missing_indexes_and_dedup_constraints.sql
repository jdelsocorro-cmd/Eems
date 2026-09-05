-- ============================================================================
-- 053_add_missing_indexes_and_dedup_constraints.sql
--
-- Three independent findings from the 2026-09-05 production readiness
-- review, bundled together since each is a single index/constraint
-- addition with no other schema impact:
--
-- 1. audit_log had no index on actor_employee_id even though 049 (applied
--    the same day) added a policy filtering by it via
--    app.employee_current_company_id(actor_employee_id) -- audit_log
--    grows on every write across the app, so any "audit trail for this
--    person" read would sequential-scan an ever-growing table.
--
-- 2. goals had no uniqueness backstop on (parent_goal_id, employee_id) --
--    the cascade endpoint's own in-memory dedup guard
--    (backend/app/api/v1/routers/goals.py) is the only thing preventing a
--    duplicate individual goal for the same employee under the same
--    parent, and it has a real gap (see the accompanying application-code
--    fix). This adds the database-level guarantee that gap was missing --
--    defense in depth, not a replacement for the code fix.
--
-- 3. completion_submissions had no guarantee that only one submission for
--    a given entity can be 'pending' at a time -- the frontend hides the
--    submit form once a pending submission exists, but nothing stopped
--    two browser tabs (or a stale cached view) from both creating one.
-- ============================================================================

create index idx_audit_log_actor on audit_log(actor_employee_id) where actor_employee_id is not null;

create unique index uq_goals_parent_employee_active on goals(parent_goal_id, employee_id)
  where deleted_at is null and parent_goal_id is not null;

create unique index uq_completion_submissions_one_pending on completion_submissions(entity_type, entity_id)
  where status = 'pending';
