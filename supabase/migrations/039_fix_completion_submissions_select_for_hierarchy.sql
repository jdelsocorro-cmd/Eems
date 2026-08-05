-- ============================================================================
-- 039_fix_completion_submissions_select_for_hierarchy.sql
--
-- Found via the live hierarchy-escalation test: a manager resolved as
-- eligible by 038's app.is_eligible_completion_reviewer() still got 404
-- approving their report's submission. Root cause: approve_completion's
-- `UPDATE ... RETURNING id` requires the row to ALSO pass the SELECT
-- policy, not just the UPDATE policy -- Postgres needs to confirm the
-- caller can "see" the row being handed back via RETURNING (the exact same
-- interaction already documented in 013_scope_aware_org_structure_mutate.
-- sql for companies_mutate). completion_submissions_select (030_completion_
-- workflow.sql) only knows about submitted_by/reviewed_by/RBAC-grant-based
-- visibility (accessible_employee_ids, which is purely employee_roles-
-- driven) -- it has no idea a hierarchy-resolved reviewer with zero grants
-- exists. Same gap silently breaks the awaiting_my_review query too: RLS
-- filters the row out before the Python-level WHERE narrowing ever runs.
--
-- Fix: same additive OR branch 038 added to completion_submissions_review,
-- added here to completion_submissions_select too. Nothing removed.
-- ============================================================================

drop policy completion_submissions_select on completion_submissions;
create policy completion_submissions_select on completion_submissions for select
  using (
    submitted_by = app.current_employee_id()
    or reviewed_by = app.current_employee_id()
    or (entity_type = 'task' and exists (
      select 1 from tasks t where t.id = completion_submissions.entity_id
        and (t.assignee_employee_id = app.current_employee_id()
             or t.assigner_employee_id = app.current_employee_id()
             or t.assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id())))
    ))
    or (entity_type = 'project' and exists (
      select 1 from projects p where p.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all'))
    ))
    or (entity_type = 'milestone' and exists (
      select 1 from milestones m join projects p on p.id = m.project_id where m.id = completion_submissions.entity_id
        and (p.owner_employee_id = app.current_employee_id()
             or exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all'))
    ))
    or app.is_eligible_completion_reviewer(app.current_employee_id(), entity_type, entity_id)
  );
