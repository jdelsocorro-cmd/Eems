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
