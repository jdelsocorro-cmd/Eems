-- ============================================================================
-- 029_milestones.sql
--
-- A named checkpoint within a project (e.g. "Phase 1 complete") -- always
-- project-scoped, per Jayson's confirmation, not a freestanding entity.
-- Visibility/mutation directly embeds projects' own visibility/ownership
-- conditions (rather than depending on a join implicitly satisfying
-- projects_select) so it reads clearly as "same rules as the parent
-- project" -- this is the same "exists (select 1 from parent_table where
-- ...)" pattern project_members_select already uses against projects.
-- ============================================================================

create type milestone_status as enum ('not_started', 'in_progress', 'done');

create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  description text,
  target_date date,
  status milestone_status not null default 'not_started',
  created_by uuid references employees(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_milestones_updated_at
  before update on milestones
  for each row execute function app.set_updated_at();

create index idx_milestones_project on milestones(project_id) where deleted_at is null;

alter table milestones enable row level security;

create policy milestones_select on milestones for select
  using (
    exists (
      select 1 from projects p
      where p.id = milestones.project_id
        and (
          exists (select 1 from project_members pm where pm.project_id = p.id and pm.employee_id = app.current_employee_id())
          or p.owner_employee_id = app.current_employee_id()
          or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'read_all')
        )
    )
  );

create policy milestones_mutate on milestones for all
  using (
    exists (
      select 1 from projects p
      where p.id = milestones.project_id
        and (p.owner_employee_id = app.current_employee_id()
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'update_all'))
    )
  )
  with check (
    exists (
      select 1 from projects p
      where p.id = milestones.project_id
        and (p.owner_employee_id = app.current_employee_id()
             or app.has_permission_on_company(app.current_employee_id(), p.company_id, 'project', 'update_all'))
    )
  );

create trigger trg_audit_milestones
  after insert or update or delete on milestones
  for each row execute function app.write_audit_log();
