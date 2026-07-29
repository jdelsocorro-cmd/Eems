-- ============================================================================
-- 007_seed_permissions.sql
-- Fixed permission catalog + system-template roles (company_id null) with
-- their permission sets pre-wired. This is what makes RBAC "not just 3 fixed
-- roles" real from day one: an admin can grant these templates as-is, clone
-- them into a company-specific role, or build entirely new ones -- the
-- catalog and the starter roles are just seed data, not hardcoded logic.
--
-- NOTE: employee_roles (the actual grants) are NOT seeded here -- no
-- employees exist yet at migration time. See supabase/seed.sql for the
-- one-time manual bootstrap step (grant the first real employee "Super
-- Admin" at company scope after they sign up).
-- ============================================================================

insert into permissions (resource, action, description) values
  ('org_structure', 'manage', 'Create/edit/reparent companies, departments, teams, positions'),
  ('employee', 'create', 'Add a new employee record'),
  ('employee', 'update', 'Edit an employee record (within accessible scope)'),
  ('role', 'manage', 'Create roles and grant/revoke role assignments'),
  ('project', 'create', 'Create a new project'),
  ('project', 'read_all', 'View all projects company-wide, not just ones you are a member of'),
  ('project', 'update_all', 'Edit any project company-wide'),
  ('kpi', 'update_value', 'Log/update a KPI current_value (within accessible scope)'),
  ('kpi', 'update_target', 'Change a KPI target/weight/direction (within accessible scope) -- the sensitive, audited action'),
  ('kpi_template', 'manage', 'Create/edit the KPI template library'),
  ('goal', 'manage', 'Create/edit company, department, team, or individual goals'),
  ('audit_log', 'read', 'View the audit log'),
  ('dashboard', 'view_executive', 'View the company-wide executive dashboard');

-- ----------------------------------------------------------------------------
-- System-template roles (company_id null)
-- ----------------------------------------------------------------------------
insert into roles (id, company_id, name, description, is_system) values
  ('00000000-0000-0000-0001-000000000001', null, 'Super Admin', 'Full access to every module -- intended for one or two founding admins per company', true),
  ('00000000-0000-0000-0001-000000000002', null, 'HR / People Admin', 'Manages org structure, employees, and role grants, but not project/KPI data', true),
  ('00000000-0000-0000-0001-000000000003', null, 'Department Head', 'Operational management permissions, typically granted at department or position_subtree scope', true),
  ('00000000-0000-0000-0001-000000000004', null, 'Manager', 'Operational management permissions, typically granted at position_subtree scope', true),
  ('00000000-0000-0000-0001-000000000005', null, 'Contributor', 'No elevated grants -- relies on the built-in self/assignee visibility every employee already has', true),
  ('00000000-0000-0000-0001-000000000006', null, 'Read-Only Exec', 'Company-wide visibility (project.read_all, dashboard.view_executive) without edit rights', true);

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000001', id from permissions; -- Super Admin: everything

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000002', id from permissions
where (resource, action) in (
  ('org_structure', 'manage'),
  ('employee', 'create'),
  ('employee', 'update'),
  ('role', 'manage'),
  ('audit_log', 'read')
);

insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.id in ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000004')
  and (p.resource, p.action) in (
    ('employee', 'update'),
    ('project', 'create'),
    ('kpi', 'update_value'),
    ('kpi', 'update_target'),
    ('goal', 'manage')
  );

insert into role_permissions (role_id, permission_id)
select '00000000-0000-0000-0001-000000000006', id from permissions
where (resource, action) in (
  ('project', 'read_all'),
  ('dashboard', 'view_executive'),
  ('audit_log', 'read')
);

-- Contributor (...005) intentionally gets no rows in role_permissions --
-- self-service (own KPIs, own tasks, tasks you assigned) is already granted
-- unconditionally by the RLS policies themselves (employee_id = self /
-- assigner_employee_id = self), so it needs no permission grants at all.
