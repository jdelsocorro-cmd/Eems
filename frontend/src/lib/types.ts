export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  timezone: string;
  is_active: boolean;
}

export interface Department {
  id: string;
  company_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
}

export interface Team {
  id: string;
  department_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
}

export type EmploymentType = "full_time" | "part_time" | "contractor";

export interface Position {
  id: string;
  team_id: string;
  title: string;
  code: string;
  reports_to_position_id: string | null;
  seniority_level: number;
  employment_type: EmploymentType;
  headcount_cap: number;
  is_active: boolean;
}

export type EmployeeStatus = "active" | "on_leave" | "offboarded";

export interface Employee {
  id: string;
  auth_user_id: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  work_email: string;
  personal_email: string | null;
  phone: string | null;
  avatar_url: string | null;
  hire_date: string | null;
  termination_date: string | null;
  status: EmployeeStatus;
}

export type AssignmentType = "permanent" | "acting" | "interim";

export interface PositionAssignment {
  id: string;
  position_id: string;
  employee_id: string;
  assignment_type: AssignmentType;
  start_date: string;
  end_date: string | null;
  is_primary: boolean;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface Role {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
}

export type ScopeType = "company" | "department" | "team" | "position_subtree" | "self";

export interface EmployeeRole {
  id: string;
  employee_id: string;
  role_id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  granted_by: string | null;
  granted_at: string;
  expires_at: string | null;
}
