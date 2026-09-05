-- ============================================================================
-- 054_bulk_import_committing_status.sql
--
-- Production readiness review (2026-09-05) found commit_import_batch
-- (backend/app/api/v1/routers/bulk_import.py) reads batch.status in
-- Python, checks it's 'previewed', then only sets it to 'committed' at
-- the very end of commit_batch() -- a double-click or a retried request
-- can both pass that check before either write lands, processing the same
-- batch twice. Today this is only coincidentally caught by unique
-- constraints on employees (work_email/employee_number) and
-- position_assignments -- the Phase 2 backlog modules (Projects, Goals,
-- KPIs) have no equivalent business-key uniqueness yet, so the same race
-- there would silently double-insert.
--
-- Fix (paired with the accompanying router change): claim the batch
-- atomically with `UPDATE import_batches SET status = 'committing'
-- WHERE id = :id AND status = 'previewed' RETURNING id` before any row
-- processing starts. A concurrent second request's UPDATE affects 0 rows
-- and gets a 409, the same compare-and-set pattern already used
-- elsewhere in this codebase for approve/reject. 'committing' is a new,
-- real status between 'previewed' and 'committed' -- not a workaround
-- state -- so it needs its own place in the CHECK constraint.
-- ============================================================================

alter table import_batches drop constraint import_batches_status_check;
alter table import_batches add constraint import_batches_status_check
  check (status = any (array['staged', 'previewed', 'committing', 'committed', 'failed', 'rolled_back']));
