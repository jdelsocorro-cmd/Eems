-- ============================================================================
-- 006_rls_policies.sql
-- RLS enabled on every table, default-deny, explicit policies using the
-- app.* functions from 003. This is the actual mechanism behind "manager
-- sees only their subtree" -- not just a rule FastAPI happens to follow, but
-- something Supabase Realtime (which talks to Postgres directly from the
-- browser, bypassing FastAPI entirely) is equally bound by.
--
-- History/audit tables (position_closure, position_hierarchy_history,
-- audit_log, task_status_history, kpi_value_history, kpi_change_log) get a
-- SELECT policy but deliberately NO insert/update/delete policy for
-- authenticated/eems_app -- the only writers are the SECURITY DEFINER
-- trigger functions from earlier migrations. This makes them tamper-proof
-- from the client side by construction, not by convention.
-- ============================================================================

-- Helper: which company does this employee currently belong to (via their
-- current position -> team -> department -> company chain). Used for
-- "same-company" visibility on org-structure tables, which are structural,
-- not personal data, so Phase 1 makes them broadly readable within a company.
create or replace function app.employee_current_company_id(p_employee_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app
as $$
  select d.company_id
  from position_assignments pa
  join positions p on p.id = pa.position_id
  join teams t on t.id = p.team_id
  join departments d on d.id = t.department_id
  where pa.employee_id = p_employee_id
    and pa.end_date is null
    and pa.is_primary
  limit 1;
$$;

-- ----------------------------------------------------------------------------
-- companies / departments / teams / positions
-- Structural, not personal -- readable by any authenticated employee of the
-- same company (this is what makes the org chart navigable company-wide per
-- the original design intent). Mutations require org_structure.manage.
-- ----------------------------------------------------------------------------
alter table companies enable row level security;
alter table departments enable row level security;
alter table teams enable row level security;
alter table positions enable row level security;

create policy companies_select on companies for select
  using (id = app.employee_current_company_id(app.current_employee_id()));

create policy companies_mutate on companies for all
  using (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

create policy departments_select on departments for select
  using (company_id = app.employee_current_company_id(app.current_employee_id()));

create policy departments_mutate on departments for all
  using (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

create policy teams_select on teams for select
  using (
    department_id in (
      select id from departments where company_id = app.employee_current_company_id(app.current_employee_id())
    )
  );

create policy teams_mutate on teams for all
  using (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

create policy positions_select on positions for select
  using (
    team_id in (
      select t.id from teams t
      join departments d on d.id = t.department_id
      where d.company_id = app.employee_current_company_id(app.current_employee_id())
    )
  );

create policy positions_mutate on positions for all
  using (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

-- ----------------------------------------------------------------------------
-- position_closure / position_hierarchy_history: read-only for clients,
-- written only by app.maintain_position_closure().
-- ----------------------------------------------------------------------------
alter table position_closure enable row level security;
alter table position_hierarchy_history enable row level security;

create policy position_closure_select on position_closure for select
  using (
    ancestor_position_id in (
      select p.id from positions p
      join teams t on t.id = p.team_id
      join departments d on d.id = t.department_id
      where d.company_id = app.employee_current_company_id(app.current_employee_id())
    )
  );

create policy position_hierarchy_history_select on position_hierarchy_history for select
  using (
    position_id in (
      select id from positions where team_id in (
        select t.id from teams t
        join departments d on d.id = t.department_id
        where d.company_id = app.employee_current_company_id(app.current_employee_id())
      )
    )
  );

-- ----------------------------------------------------------------------------
-- employees: self, or within an accessible subtree/scope. This is PII
-- (personal_email, phone, termination_date) so it is intentionally NOT
-- opened up company-wide the way org-structure tables are.
-- ----------------------------------------------------------------------------
alter table employees enable row level security;

create policy employees_select on employees for select
  using (
    id = app.current_employee_id()
    or id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

create policy employees_update on employees for update
  using (
    id = app.current_employee_id()
    or app.has_permission_on_employee(app.current_employee_id(), id, 'employee', 'update')
  )
  with check (
    id = app.current_employee_id()
    or app.has_permission_on_employee(app.current_employee_id(), id, 'employee', 'update')
  );

create policy employees_insert on employees for insert
  with check (app.has_permission(app.current_employee_id(), 'employee', 'create'));

-- No employees_delete policy -- offboarding is a status change (see
-- services/offboarding.py in the backend), never a DELETE. Rows with audit
-- history attached must never be hard-deleted.

-- ----------------------------------------------------------------------------
-- position_assignments: visible under the same scope as the employee/position
-- it links; mutations require org_structure.manage (assigning someone to a
-- seat is a structural/HR action, not a self-service one).
-- ----------------------------------------------------------------------------
alter table position_assignments enable row level security;

create policy position_assignments_select on position_assignments for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

create policy position_assignments_mutate on position_assignments for all
  using (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'org_structure', 'manage'));

-- ----------------------------------------------------------------------------
-- RBAC tables
-- ----------------------------------------------------------------------------
alter table permissions enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table employee_roles enable row level security;

-- Permission catalog: readable by anyone authenticated (needed to render the
-- RBAC admin permission matrix); never client-writable, only via migration.
create policy permissions_select on permissions for select using (true);

create policy roles_select on roles for select
  using (
    company_id is null
    or company_id = app.employee_current_company_id(app.current_employee_id())
  );

create policy roles_mutate on roles for all
  using (app.has_permission(app.current_employee_id(), 'role', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'role', 'manage'));

create policy role_permissions_select on role_permissions for select
  using (
    role_id in (
      select id from roles
      where company_id is null or company_id = app.employee_current_company_id(app.current_employee_id())
    )
  );

create policy role_permissions_mutate on role_permissions for all
  using (app.has_permission(app.current_employee_id(), 'role', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'role', 'manage'));

create policy employee_roles_select on employee_roles for select
  using (
    employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'role', 'manage')
  );

create policy employee_roles_mutate on employee_roles for all
  using (app.has_permission(app.current_employee_id(), 'role', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'role', 'manage'));

-- ----------------------------------------------------------------------------
-- audit_log: admin read-only, no client writes (only app.write_audit_log()).
-- ----------------------------------------------------------------------------
alter table audit_log enable row level security;

create policy audit_log_select on audit_log for select
  using (app.has_permission(app.current_employee_id(), 'audit_log', 'read'));

-- ----------------------------------------------------------------------------
-- projects / project_members
-- Phase 1 simplification: visible to project members and to anyone holding
-- 'project'/'read_all' (typically a company-scope Exec role) -- project
-- visibility isn't derived from the position-subtree the way employee/task
-- visibility is, since a project can span multiple teams by design.
-- ----------------------------------------------------------------------------
alter table projects enable row level security;
alter table project_members enable row level security;

create policy projects_select on projects for select
  using (
    exists (select 1 from project_members pm where pm.project_id = projects.id and pm.employee_id = app.current_employee_id())
    or owner_employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'project', 'read_all')
  );

create policy projects_insert on projects for insert
  with check (app.has_permission(app.current_employee_id(), 'project', 'create'));

create policy projects_update on projects for update
  using (
    owner_employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'project', 'update_all')
  )
  with check (
    owner_employee_id = app.current_employee_id()
    or app.has_permission(app.current_employee_id(), 'project', 'update_all')
  );

create policy project_members_select on project_members for select
  using (
    employee_id = app.current_employee_id()
    or exists (select 1 from project_members pm2 where pm2.project_id = project_members.project_id and pm2.employee_id = app.current_employee_id())
    or app.has_permission(app.current_employee_id(), 'project', 'read_all')
  );

create policy project_members_mutate on project_members for all
  using (
    exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission(app.current_employee_id(), 'project', 'update_all')
  )
  with check (
    exists (select 1 from projects p where p.id = project_members.project_id and p.owner_employee_id = app.current_employee_id())
    or app.has_permission(app.current_employee_id(), 'project', 'update_all')
  );

-- ----------------------------------------------------------------------------
-- tasks / task_comments / task_attachments
-- ----------------------------------------------------------------------------
alter table tasks enable row level security;
alter table task_status_history enable row level security;
alter table task_comments enable row level security;
alter table task_attachments enable row level security;

create policy tasks_select on tasks for select
  using (
    assignee_employee_id = app.current_employee_id()
    or assigner_employee_id = app.current_employee_id()
    or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

create policy tasks_insert on tasks for insert
  with check (
    assigner_employee_id = app.current_employee_id()
    and (
      assignee_employee_id = app.current_employee_id()
      or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy tasks_update on tasks for update
  using (
    assignee_employee_id = app.current_employee_id()
    or assigner_employee_id = app.current_employee_id()
    or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  )
  with check (
    assignee_employee_id = app.current_employee_id()
    or assigner_employee_id = app.current_employee_id()
    or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

create policy task_status_history_select on task_status_history for select
  using (
    task_id in (
      select id from tasks
      where assignee_employee_id = app.current_employee_id()
         or assigner_employee_id = app.current_employee_id()
         or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy task_comments_select on task_comments for select
  using (
    task_id in (
      select id from tasks
      where assignee_employee_id = app.current_employee_id()
         or assigner_employee_id = app.current_employee_id()
         or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy task_comments_insert on task_comments for insert
  with check (
    employee_id = app.current_employee_id()
    and task_id in (
      select id from tasks
      where assignee_employee_id = app.current_employee_id()
         or assigner_employee_id = app.current_employee_id()
         or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy task_attachments_select on task_attachments for select
  using (
    task_id in (
      select id from tasks
      where assignee_employee_id = app.current_employee_id()
         or assigner_employee_id = app.current_employee_id()
         or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy task_attachments_insert on task_attachments for insert
  with check (
    uploaded_by = app.current_employee_id()
    and task_id in (
      select id from tasks
      where assignee_employee_id = app.current_employee_id()
         or assigner_employee_id = app.current_employee_id()
         or assignee_employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

-- ----------------------------------------------------------------------------
-- goals: company/department/team-level goals are visible company-wide
-- (alignment views need to see up the chain); individual goals follow the
-- same self-or-subtree rule as employees/tasks.
-- ----------------------------------------------------------------------------
alter table goals enable row level security;

create policy goals_select on goals for select
  using (
    (goal_type in ('company', 'department', 'team')
      and company_id = app.employee_current_company_id(app.current_employee_id()))
    or (goal_type = 'individual'
      and (employee_id = app.current_employee_id()
           or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))))
  );

create policy goals_mutate on goals for all
  using (app.has_permission(app.current_employee_id(), 'goal', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'goal', 'manage'));

-- ----------------------------------------------------------------------------
-- kpi_templates: company-wide readable library; mutation requires
-- kpi_template.manage.
-- ----------------------------------------------------------------------------
alter table kpi_templates enable row level security;

create policy kpi_templates_select on kpi_templates for select
  using (
    company_id is null
    or company_id = app.employee_current_company_id(app.current_employee_id())
  );

create policy kpi_templates_mutate on kpi_templates for all
  using (app.has_permission(app.current_employee_id(), 'kpi_template', 'manage'))
  with check (app.has_permission(app.current_employee_id(), 'kpi_template', 'manage'));

-- ----------------------------------------------------------------------------
-- kpis / kpi_value_history / kpi_change_log / kpi_scores
-- ----------------------------------------------------------------------------
alter table kpis enable row level security;
alter table kpi_value_history enable row level security;
alter table kpi_change_log enable row level security;
alter table kpi_scores enable row level security;

create policy kpis_select on kpis for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

create policy kpis_insert on kpis for insert
  with check (app.has_permission_on_employee(app.current_employee_id(), employee_id, 'kpi', 'update_target'));

-- current_value updates are allowed more broadly (self-service progress
-- logging); target/weight/direction changes are further restricted by the
-- app.enforce_kpi_sensitive_changes() BEFORE trigger from 005, which RLS
-- alone can't express at column granularity.
create policy kpis_update on kpis for update
  using (
    employee_id = app.current_employee_id()
    or app.has_permission_on_employee(app.current_employee_id(), employee_id, 'kpi', 'update_value')
    or app.has_permission_on_employee(app.current_employee_id(), employee_id, 'kpi', 'update_target')
  )
  with check (
    employee_id = app.current_employee_id()
    or app.has_permission_on_employee(app.current_employee_id(), employee_id, 'kpi', 'update_value')
    or app.has_permission_on_employee(app.current_employee_id(), employee_id, 'kpi', 'update_target')
  );

create policy kpi_value_history_select on kpi_value_history for select
  using (
    kpi_id in (
      select id from kpis
      where employee_id = app.current_employee_id()
         or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy kpi_change_log_select on kpi_change_log for select
  using (
    kpi_id in (
      select id from kpis
      where employee_id = app.current_employee_id()
         or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
    )
  );

create policy kpi_scores_select on kpi_scores for select
  using (
    employee_id = app.current_employee_id()
    or employee_id in (select app.accessible_employee_ids(app.current_employee_id()))
  );

-- No client insert policy on kpi_scores -- snapshots are written exclusively
-- by the backend's scoring service using the service role (POST
-- /scores/compute, a system-permission-only endpoint per the API surface),
-- never by a row-level client write.
