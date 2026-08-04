-- ============================================================================
-- 037_block_self_approval.sql
--
-- Found live: an account holding completion.review at broad/unrestricted
-- scope (e.g. Super Admin) could approve its OWN completion_submissions --
-- has_permission_on_employee(self, self, 'completion', 'review') is true
-- whenever the caller holds the permission at all, because
-- accessible_employee_ids() always includes the caller themself (self-
-- visibility is meant to never depend on having a role grant). That's
-- correct for "can I see my own record", but completion_submissions_review
-- (030_completion_workflow.sql) reused the exact same check for "can I
-- APPROVE this", which defeats the entire "prevents self-scoring bias"
-- point of this workflow for anyone whose review permission happens to be
-- broad enough to cover themselves.
--
-- Fix: reviewer can never be the same person as the submitter, full stop --
-- independent of scope, permission breadth, or entity type. This is a hard
-- rule layered on top of the existing eligibility checks, not a
-- replacement for them.
-- ============================================================================

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
    )
  )
  with check (
    reviewed_by = app.current_employee_id()
    and status in ('approved', 'rejected')
  );
