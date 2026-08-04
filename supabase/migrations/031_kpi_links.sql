-- ============================================================================
-- 031_kpi_links.sql
--
-- Many-to-many evidence links between a KPI and the tasks/projects/
-- milestones that count toward it. Three separate tables with real FKs,
-- not one polymorphic table like completion_submissions (030) -- these are
-- core data relationships (what actually backs a KPI's value), not
-- workflow metadata, so they get the same referential-integrity guarantee
-- every other relationship in this schema has. Postgres can't enforce a
-- polymorphic FK across three target tables; three typed tables can.
--
-- Each link's `weight` is what Jayson's "configurable completion rules"
-- means in practice: how much that piece of evidence counts toward the
-- KPI's current_value, computed as a weighted average of linked items'
-- completion_score -- the exact same weighted-average shape
-- app.compute_employee_score() already uses one level up, just applied one
-- level down. Mutating a link changes what a KPI is worth, so it requires
-- the same kpi.update_target right that changing the KPI's own
-- target/weight already requires (app.enforce_kpi_sensitive_changes(),
-- 005_goals_kpis.sql) -- linking evidence is exactly that sensitive.
-- ============================================================================

create table kpi_tasks (
  kpi_id uuid not null references kpis(id),
  task_id uuid not null references tasks(id),
  weight numeric(5,2) not null default 1,
  created_at timestamptz not null default now(),
  primary key (kpi_id, task_id)
);

create table kpi_projects (
  kpi_id uuid not null references kpis(id),
  project_id uuid not null references projects(id),
  weight numeric(5,2) not null default 1,
  created_at timestamptz not null default now(),
  primary key (kpi_id, project_id)
);

create table kpi_milestones (
  kpi_id uuid not null references kpis(id),
  milestone_id uuid not null references milestones(id),
  weight numeric(5,2) not null default 1,
  created_at timestamptz not null default now(),
  primary key (kpi_id, milestone_id)
);

create index idx_kpi_tasks_task on kpi_tasks(task_id);
create index idx_kpi_projects_project on kpi_projects(project_id);
create index idx_kpi_milestones_milestone on kpi_milestones(milestone_id);

alter table kpi_tasks enable row level security;
alter table kpi_projects enable row level security;
alter table kpi_milestones enable row level security;

-- Visible if the caller can see the KPI (kpis_select's own self-or-subtree
-- rule) -- the linked task/project/milestone's own visibility doesn't
-- additionally gate this, since "which evidence backs this KPI" is
-- information about the KPI, not about the linked item.
create policy kpi_tasks_select on kpi_tasks for select
  using (exists (
    select 1 from kpis k where k.id = kpi_id
      and (k.employee_id = app.current_employee_id() or k.employee_id in (select app.accessible_employee_ids(app.current_employee_id())))
  ));

create policy kpi_tasks_mutate on kpi_tasks for all
  using (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')))
  with check (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')));

create policy kpi_projects_select on kpi_projects for select
  using (exists (
    select 1 from kpis k where k.id = kpi_id
      and (k.employee_id = app.current_employee_id() or k.employee_id in (select app.accessible_employee_ids(app.current_employee_id())))
  ));

create policy kpi_projects_mutate on kpi_projects for all
  using (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')))
  with check (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')));

create policy kpi_milestones_select on kpi_milestones for select
  using (exists (
    select 1 from kpis k where k.id = kpi_id
      and (k.employee_id = app.current_employee_id() or k.employee_id in (select app.accessible_employee_ids(app.current_employee_id())))
  ));

create policy kpi_milestones_mutate on kpi_milestones for all
  using (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')))
  with check (exists (select 1 from kpis k where k.id = kpi_id and app.has_permission_on_employee(app.current_employee_id(), k.employee_id, 'kpi', 'update_target')));

-- These three tables have composite primary keys (kpi_id, task_id) etc,
-- not an `id` column -- app.write_audit_log() assumes NEW.id/OLD.id exist
-- (it's what every other trigger in this migration set uses), so these use
-- the composite-key variant instead, the same distinction role_permissions
-- already established (002_rbac.sql).
create trigger trg_audit_kpi_tasks after insert or update or delete on kpi_tasks for each row execute function app.write_audit_log_composite_key();
create trigger trg_audit_kpi_projects after insert or update or delete on kpi_projects for each row execute function app.write_audit_log_composite_key();
create trigger trg_audit_kpi_milestones after insert or update or delete on kpi_milestones for each row execute function app.write_audit_log_composite_key();
