-- ============================================================================
-- 004_projects_tasks.sql
-- Projects and Tasks. tasks deliberately has no sprint_id column -- Sprint &
-- Kanban (a future phase) is a pure additive ALTER TABLE later, because
-- status/sort_order already fully define a task without sprints existing.
-- ============================================================================

create type project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type priority_level as enum ('low', 'medium', 'high', 'critical');

create table projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  department_id uuid references departments(id),
  team_id uuid references teams(id),
  name text not null,
  description text,
  status project_status not null default 'planning',
  owner_employee_id uuid not null references employees(id),
  priority priority_level not null default 'medium',
  color text,
  start_date date,
  target_end_date date,
  actual_end_date date,
  created_by uuid references employees(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_projects_updated_at
  before update on projects
  for each row execute function app.set_updated_at();

create trigger trg_audit_projects
  after insert or update or delete on projects
  for each row execute function app.write_audit_log();

create index idx_projects_company on projects(company_id) where deleted_at is null;
create index idx_projects_department on projects(department_id) where deleted_at is null;
create index idx_projects_team on projects(team_id) where deleted_at is null;
create index idx_projects_owner on projects(owner_employee_id);

create type project_member_role as enum ('owner', 'contributor', 'viewer');

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  employee_id uuid not null references employees(id),
  role_in_project project_member_role not null default 'contributor',
  added_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create index idx_project_members_employee on project_members(employee_id);

create type task_status as enum ('todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id), -- null = standalone task
  parent_task_id uuid references tasks(id), -- subtasks
  title text not null,
  description text,
  status task_status not null default 'todo',
  priority priority_level not null default 'medium',
  assignee_employee_id uuid references employees(id),
  assigner_employee_id uuid references employees(id),
  start_date date,
  due_date date,
  estimated_hours numeric(6,2),
  actual_hours numeric(6,2),
  sort_order int not null default 0,
  created_by uuid references employees(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_tasks_no_self_parent check (parent_task_id is distinct from id)
);

create trigger trg_tasks_updated_at
  before update on tasks
  for each row execute function app.set_updated_at();

create trigger trg_audit_tasks
  after insert or update or delete on tasks
  for each row execute function app.write_audit_log();

create index idx_tasks_project on tasks(project_id) where deleted_at is null;
create index idx_tasks_assignee on tasks(assignee_employee_id) where deleted_at is null;
create index idx_tasks_parent on tasks(parent_task_id) where deleted_at is null;

create table task_status_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  old_status task_status,
  new_status task_status not null,
  changed_by uuid references employees(id),
  changed_at timestamptz not null default now()
);

create index idx_task_status_history_task on task_status_history(task_id);

-- security definer: task_status_history has no direct INSERT policy for
-- authenticated/eems_app (006_rls_policies.sql) -- only this trigger writes it.
create or replace function app.log_task_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if tg_op = 'INSERT' then
    insert into task_status_history (task_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, app.current_employee_id());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into task_status_history (task_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, app.current_employee_id());
  end if;
  return new;
end;
$$;

create trigger trg_tasks_status_history
  after insert or update on tasks
  for each row execute function app.log_task_status_change();

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  employee_id uuid not null references employees(id),
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_task_comments_updated_at
  before update on task_comments
  for each row execute function app.set_updated_at();

create index idx_task_comments_task on task_comments(task_id) where deleted_at is null;

create table task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  storage_path text not null, -- Supabase Storage object key
  file_name text not null,
  file_size_bytes bigint,
  uploaded_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create index idx_task_attachments_task on task_attachments(task_id);
