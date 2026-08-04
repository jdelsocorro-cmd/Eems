-- ============================================================================
-- 030_completion_workflow.sql
--
-- The submit -> review -> approve/reject state machine shared by tasks,
-- projects, and milestones. One table, not three near-identical ones --
-- entity_type + entity_id is deliberately NOT a real FK (Postgres can't
-- enforce a polymorphic FK across three target tables); this is workflow/
-- audit metadata, not a core data relationship, the same "plain uuid is
-- fine here" reasoning audit_log.record_id already uses elsewhere in this
-- schema. kpi_tasks/kpi_projects/kpi_milestones (031) are core data
-- relationships and get real FKs instead.
--
-- New permission `completion.review`, mirroring how kpi.update_target
-- already gets its own fine-grained permission rather than overloading a
-- generic one -- approving/rejecting someone's work is exactly that kind
-- of sensitive, specifically-named action. Granted to the same system
-- roles kpi.update_target already reaches (Department Head, Manager,
-- Super Admin already has everything).
-- ============================================================================

insert into permissions (resource, action, description) values
  ('completion', 'review', 'Approve or reject a task/project/milestone completion submission (within accessible scope)');

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000001', id from permissions where (resource, action) = ('completion', 'review');

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.id in ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000004')
  and (p.resource, p.action) = ('completion', 'review');

create type completion_entity_type as enum ('task', 'project', 'milestone');
create type completion_status as enum ('pending', 'approved', 'rejected');

create table completion_submissions (
  id uuid primary key default gen_random_uuid(),
  entity_type completion_entity_type not null,
  entity_id uuid not null,
  submitted_by uuid not null references employees(id),
  summary text not null,
  submitted_at timestamptz not null default now(),
  status completion_status not null default 'pending',
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  completion_score numeric(5,2) check (completion_score is null or (completion_score >= 0 and completion_score <= 100)),
  rejection_feedback text
);

create index idx_completion_submissions_entity on completion_submissions(entity_type, entity_id);
create index idx_completion_submissions_pending on completion_submissions(status) where status = 'pending';

create table completion_evidence_links (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references completion_submissions(id),
  url text not null,
  label text,
  added_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create index idx_completion_evidence_links_submission on completion_evidence_links(submission_id);

alter table completion_submissions enable row level security;
alter table completion_evidence_links enable row level security;

-- Visible to the submitter, the reviewer, and anyone who could already see
-- the underlying task/project/milestone via that entity's own visibility
-- rules -- three OR'd branches since entity_type is polymorphic and can't
-- be a single join.
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
  );

-- Only the person actually responsible for the work can submit it for
-- review -- assignee for a task, owner for a project/milestone. status is
-- pinned to 'pending' here; only the review policy below can move it.
create policy completion_submissions_insert on completion_submissions for insert
  with check (
    submitted_by = app.current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and (
      (entity_type = 'task' and exists (select 1 from tasks t where t.id = entity_id and t.assignee_employee_id = app.current_employee_id()))
      or (entity_type = 'project' and exists (select 1 from projects p where p.id = entity_id and p.owner_employee_id = app.current_employee_id()))
      or (entity_type = 'milestone' and exists (select 1 from milestones m join projects p on p.id = m.project_id where m.id = entity_id and p.owner_employee_id = app.current_employee_id()))
    )
  );

-- Approve/reject. USING requires status = 'pending' on the row being
-- touched, which is what makes "approving twice" impossible -- once a row
-- moves to approved/rejected it no longer matches this policy for a second
-- UPDATE attempt, so a repeat call affects zero rows rather than silently
-- re-approving. Reviewer must be the task's assigner, or hold
-- completion.review scoped to the entity's responsible employee (covers
-- "any manager above them in the chain", via the same
-- has_permission_on_employee/accessible_employee_ids machinery every other
-- manager-approval check in this schema already uses -- no new org-chart
-- lookup needed).
create policy completion_submissions_review on completion_submissions for update
  using (
    status = 'pending'
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

create trigger trg_audit_completion_submissions
  after insert or update or delete on completion_submissions
  for each row execute function app.write_audit_log();

-- Evidence links: visible/insertable exactly when the parent submission is
-- (the subquery is itself subject to completion_submissions' own RLS, so
-- this composes rather than needing the same three-way entity_type branch
-- repeated here). Append-only -- no update/delete policy, matching
-- task_comments' low-stakes evidence-trail pattern -- and only the
-- submitter can attach links, only while their submission is still pending.
create policy completion_evidence_links_select on completion_evidence_links for select
  using (exists (select 1 from completion_submissions cs where cs.id = submission_id));

create policy completion_evidence_links_insert on completion_evidence_links for insert
  with check (
    added_by = app.current_employee_id()
    and exists (
      select 1 from completion_submissions cs
      where cs.id = submission_id and cs.submitted_by = app.current_employee_id() and cs.status = 'pending'
    )
  );
