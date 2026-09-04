export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  timezone: string;
  is_active: boolean;
  recognition_score_threshold: number;
}

export interface OrgUnit {
  id: string;
  company_id: string;
  parent_unit_id: string | null;
  unit_type: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
}

export type EmploymentType = "full_time" | "part_time" | "contractor";

export interface Position {
  id: string;
  org_unit_id: string;
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
  employment_type: EmploymentType | null;
  status: EmployeeStatus;
  password_reset_requested_at: string | null;
}

export interface EmployeeProfileSummary {
  id: string;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  work_email: string;
  status: EmployeeStatus;
  hire_date: string | null;
  tenure_days: number | null;
  position_title: string | null;
  org_unit_name: string | null;
  manager: { id: string; first_name: string; last_name: string } | null;
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

export type ScopeType = "company" | "org_unit" | "position_subtree" | "self";

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

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";
export type PriorityLevel = "low" | "medium" | "high" | "critical";
export type ProjectMemberRole = "owner" | "contributor" | "viewer";
export type TaskStatus = "todo" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";

export interface Project {
  id: string;
  company_id: string;
  org_unit_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner_employee_id: string;
  priority: PriorityLevel;
  color: string | null;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMember {
  project_id: string;
  employee_id: string;
  role_in_project: ProjectMemberRole;
  added_at: string;
}

export interface TaskCategory {
  id: string;
  company_id: string;
  name: string;
  is_active: boolean;
}

export interface Task {
  id: string;
  project_id: string | null;
  parent_task_id: string | null;
  task_category_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: PriorityLevel;
  assignee_employee_id: string | null;
  assigner_employee_id: string | null;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskStatusHistoryEntry {
  id: string;
  task_id: string;
  old_status: TaskStatus | null;
  new_status: TaskStatus;
  changed_by: string | null;
  changed_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  employee_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export type GoalType = "company" | "org_unit" | "individual";
export type GoalStatus = "draft" | "active" | "completed" | "archived" | "cancelled";
export type KpiDirection = "higher_is_better" | "lower_is_better" | "target_is_exact";
export type KpiStatus = "active" | "completed" | "archived";
export type ScoreComputedBy = "system" | "manual";

export interface Goal {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  goal_type: GoalType;
  org_unit_id: string | null;
  employee_id: string | null;
  owner_employee_id: string | null;
  parent_goal_id: string | null;
  period_start: string;
  period_end: string;
  status: GoalStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiTemplate {
  id: string;
  company_id: string | null;
  org_unit_id: string | null;
  name: string;
  description: string | null;
  unit: string;
  direction: KpiDirection;
  default_weight: number;
  is_active: boolean;
}

export interface Kpi {
  id: string;
  employee_id: string;
  goal_id: string | null;
  kpi_template_id: string | null;
  task_id: string | null;
  name: string;
  unit: string;
  direction: KpiDirection;
  target_value: number;
  current_value: number;
  weight: number;
  period_start: string;
  period_end: string;
  status: KpiStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KpiValueHistoryEntry {
  id: string;
  kpi_id: string;
  old_value: number | null;
  new_value: number;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

export interface KpiChangeLogEntry {
  id: string;
  kpi_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

export interface StatusCounts {
  counts: Record<string, number>;
  total: number;
}

export interface ScoreTrendPoint {
  period_start: string;
  average_score: number;
}

export interface DashboardData {
  scope_type: "company" | "org_unit";
  scope_id: string;
  headcount: StatusCounts;
  projects: StatusCounts;
  tasks: StatusCounts;
  goals: StatusCounts;
  average_score: number | null;
  scored_employee_count: number;
  score_trend: ScoreTrendPoint[];
  kpi_evidence_coverage_pct: number | null;
}

export interface KpiScore {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  computed_score: number | null;
  kpi_snapshot: Array<{ kpi_id: string; name: string; target_value: number; current_value: number; weight: number; direction: KpiDirection }>;
  computed_at: string;
  computed_by: ScoreComputedBy;
}

export type MilestoneStatus = "not_started" | "in_progress" | "done";

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  status: MilestoneStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CompletionEntityType = "task" | "project" | "milestone";
export type CompletionStatus = "pending" | "approved" | "rejected";

export interface CompletionSubmission {
  id: string;
  entity_type: CompletionEntityType;
  entity_id: string;
  submitted_by: string;
  summary: string;
  submitted_at: string;
  status: CompletionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  completion_score: number | null;
  rejection_feedback: string | null;
}

export interface CompletionEvidenceLink {
  id: string;
  submission_id: string;
  url: string;
  label: string | null;
  added_by: string | null;
  created_at: string;
}

export interface KpiTask {
  kpi_id: string;
  task_id: string;
  weight: number;
  created_at: string;
}

export interface KpiProject {
  kpi_id: string;
  project_id: string;
  weight: number;
  created_at: string;
}

export interface KpiMilestone {
  kpi_id: string;
  milestone_id: string;
  weight: number;
  created_at: string;
}

export type RecognitionRelatedEntityType = "task" | "project" | "milestone" | "kpi";

export interface Recognition {
  id: string;
  employee_id: string;
  given_by: string;
  category: string;
  message: string;
  related_entity_type: RecognitionRelatedEntityType | null;
  related_entity_id: string | null;
  created_at: string;
}

export interface PositionScore {
  id: string;
  position_id: string;
  period_start: string;
  period_end: string;
  computed_score: number | null;
  computed_at: string;
}

export type HelpArticleStatus = "draft" | "published" | "archived";

export interface HelpCategory {
  id: string;
  company_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HelpArticle {
  id: string;
  company_id: string;
  category_id: string | null;
  title: string;
  body_markdown: string;
  tags: string[];
  status: HelpArticleStatus;
  view_count: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface HelpArticleRole {
  article_id: string;
  role_id: string;
  created_at: string;
}

export interface HelpArticleVersion {
  id: string;
  article_id: string;
  version_no: number;
  title: string;
  body_markdown: string;
  edited_by: string | null;
  edited_at: string;
}

export type SupportCategory = "bug" | "ux_issue" | "performance" | "data_issue" | "feature_request" | "question" | "other";
export type SupportTicketStatus = "new" | "acknowledged" | "in_progress" | "resolved" | "closed";

export interface SupportTicket {
  id: string;
  company_id: string;
  reported_by: string;
  title: string;
  description: string;
  category: SupportCategory;
  severity: PriorityLevel;
  status: SupportTicketStatus;
  page_url: string | null;
  user_agent: string | null;
  screenshot_path: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketNote {
  id: string;
  ticket_id: string;
  employee_id: string;
  note: string;
  created_at: string;
}

export type ImportMode = "insert_only" | "upsert" | "update_only" | "skip_duplicates";
export type FieldStrategy = "non_empty_only" | "overwrite_all";
export type ImportBatchStatus = "staged" | "previewed" | "committed" | "failed" | "rolled_back";
export type ImportRowAction = "insert" | "update" | "skip" | "reject";

export interface ImportBatch {
  id: string;
  module: string;
  initiated_by: string;
  company_id: string;
  import_mode: ImportMode;
  field_strategy: FieldStrategy;
  file_name: string;
  status: ImportBatchStatus;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  rejected_count: number;
  created_at: string;
  committed_at: string | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
}

export interface ImportBatchRow {
  id: string;
  batch_id: string;
  row_number: number;
  raw_data: Record<string, string>;
  matching_key_value: string | null;
  action: ImportRowAction;
  target_record_id: string | null;
  old_data: Record<string, unknown> | null;
  validation_errors: string[] | null;
  committed_at: string | null;
}

export interface ReviewDelegation {
  id: string;
  delegator_employee_id: string;
  delegate_employee_id: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
}
