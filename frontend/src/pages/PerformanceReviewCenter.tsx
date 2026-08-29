import { useMemo, useState } from "react";

import { EmployeeLink } from "@/components/EmployeeLink";
import { Button, Card, ErrorBanner, LoadingState, SortHeader, StatStrip, Table, TableEmptyRow, TableHead, Td, Tr } from "@/components/ui";
import {
  useAllEmployees,
  useScopedCompletionSubmissions,
  useScopedGoals,
  useScopedKpis,
  useScopedProjects,
  useScopedScores,
  useScopedTasks,
} from "@/hooks/usePerformanceReviewData";
import type {
  CompletionSubmission,
  Employee,
  Goal,
  GoalStatus,
  Kpi,
  KpiScore,
  KpiStatus,
  PriorityLevel,
  Project,
  ProjectStatus,
  Task,
  TaskStatus,
} from "@/lib/types";

type Tab = "performance" | "tasks" | "projects" | "goals";

const TABS: { id: Tab; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "tasks", label: "Tasks" },
  { id: "projects", label: "Projects" },
  { id: "goals", label: "Goals & KPIs" },
];

// Multi-person companion to Employee 360 (which is the single-person read-
// only profile) -- an executive/management workspace showing Performance/
// Tasks/Projects/Goals & KPIs aggregated across everyone the caller is
// responsible for. Deliberately has NO scope picker (contrast
// ExecutiveDashboard.tsx's company/org-unit <select>): tasks_select/
// projects_select/goals_select/kpis_select/kpi_scores_select/completion_
// submissions_select (040_employee_360_hierarchy_visibility.sql) already
// resolve "everything this caller can see" across all four RBAC scope
// types (self/position_subtree/org_unit/company) plus management-hierarchy
// visibility, with zero caller-supplied parameter -- see
// usePerformanceReviewData.ts. No permission gate on this page either
// (matches Leadership Scorecard/Executive Dashboard/Goals precedent) --
// Department Head and Manager, the actual "management" audience, don't
// hold dashboard.view_executive by default (007_seed_permissions.sql), so
// gating on it would hide this page from exactly the people it's for. RLS
// is the only real boundary; a Contributor with no elevated grants just
// sees a page that's mostly their own row.
export default function PerformanceReviewCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("performance");

  const needTasks = activeTab === "tasks";
  const needProjects = activeTab === "projects";
  const needGoals = activeTab === "goals";
  const needKpis = activeTab === "performance" || activeTab === "goals";
  const needScores = activeTab === "performance";
  const needSubmissions = activeTab === "performance";

  const employeesQuery = useAllEmployees();
  const tasksQuery = useScopedTasks(needTasks);
  const projectsQuery = useScopedProjects(needProjects);
  const goalsQuery = useScopedGoals(needGoals);
  const kpisQuery = useScopedKpis(needKpis);
  const scoresQuery = useScopedScores(needScores);
  const submissionsQuery = useScopedCompletionSubmissions(needSubmissions);

  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);

  function employeeName(id: string | null): string {
    if (!id) return "Unassigned";
    const emp = employeesById.get(id);
    return emp ? `${emp.first_name} ${emp.last_name}` : "Unknown";
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Performance Review Center</h1>
        <p className="mt-1 text-sm text-text-muted">
          Showing everyone within your management scope, automatically -- no scope selection needed.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <Button key={tab.id} variant="toolbar" size="sm" active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "performance" && (
        <PerformanceTab
          employees={employeesQuery.data ?? []}
          scores={scoresQuery.data ?? []}
          kpis={kpisQuery.data ?? []}
          submissions={submissionsQuery.data ?? []}
          loading={employeesQuery.isLoading || scoresQuery.isLoading || kpisQuery.isLoading || submissionsQuery.isLoading}
          error={employeesQuery.isError || scoresQuery.isError || kpisQuery.isError || submissionsQuery.isError}
        />
      )}
      {activeTab === "tasks" && (
        <TasksTab tasks={tasksQuery.data ?? []} employeeName={employeeName} loading={tasksQuery.isLoading} error={tasksQuery.isError} />
      )}
      {activeTab === "projects" && (
        <ProjectsTab
          projects={projectsQuery.data ?? []}
          employeeName={employeeName}
          loading={projectsQuery.isLoading}
          error={projectsQuery.isError}
        />
      )}
      {activeTab === "goals" && (
        <GoalsKpisTab
          goals={goalsQuery.data ?? []}
          kpis={kpisQuery.data ?? []}
          employeeName={employeeName}
          loading={goalsQuery.isLoading || kpisQuery.isLoading}
          error={goalsQuery.isError || kpisQuery.isError}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared small pieces (stat strip, status-pill filter) -- each tab below has
// different columns/statuses, so filter/sort state stays local to each tab
// rather than one shared mega-hook. SortHeader itself is the app-wide shared
// one from components/ui (was a near-identical duplicate defined locally
// here and in UserManagement.tsx).
// ----------------------------------------------------------------------------

function StatusPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-edge-md bg-surface2 p-1 text-xs">
      {options.map((opt) => (
        <Button key={opt.value} variant="toolbar" size="sm" active={value === opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

function EmployeeCell({ employeeId, name }: { employeeId: string | null; name: string }) {
  if (!employeeId) return <span className="text-text-dim">Unassigned</span>;
  return <EmployeeLink employeeId={employeeId} name={name} />;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type="search"
      className="min-w-[200px] flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
    />
  );
}

const PRIORITY_ORDER: Record<PriorityLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

// ----------------------------------------------------------------------------
// Performance tab -- built on kpi_scores (GET /scores, correctly subtree-
// scoped) + kpis + completion_submissions. Deliberately never calls GET
// /scores/position-scores (see file-header comment and
// usePerformanceReviewData.ts) -- that table's RLS is company-scoped, not
// subtree-scoped, and would over-expose data to a position_subtree-only
// manager.
// ----------------------------------------------------------------------------

type PerformanceSortColumn = "name" | "score" | "activeKpis" | "pending";

function PerformanceTab({
  employees,
  scores,
  kpis,
  submissions,
  loading,
  error,
}: {
  employees: Employee[];
  scores: KpiScore[];
  kpis: Kpi[];
  submissions: CompletionSubmission[];
  loading: boolean;
  error: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "scored" | "not_scored">("all");
  const [sortColumn, setSortColumn] = useState<PerformanceSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const latestScoreByEmployee = useMemo(() => {
    const map = new Map<string, KpiScore>();
    for (const s of scores) {
      const existing = map.get(s.employee_id);
      if (!existing || new Date(s.computed_at) > new Date(existing.computed_at)) map.set(s.employee_id, s);
    }
    return map;
  }, [scores]);

  const activeKpiCountByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const k of kpis) {
      if (k.status !== "active") continue;
      map.set(k.employee_id, (map.get(k.employee_id) ?? 0) + 1);
    }
    return map;
  }, [kpis]);

  const pendingReviewCountByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      if (s.status !== "pending") continue;
      map.set(s.submitted_by, (map.get(s.submitted_by) ?? 0) + 1);
    }
    return map;
  }, [submissions]);

  // Employees are already scoped correctly by employees_select RLS (same
  // hierarchy_subtree_employee_ids branch as the other tables) -- limiting
  // to employees with at least one signal here avoids an all-empty wall at
  // higher headcount, not a scope narrowing.
  const rows = useMemo(() => {
    return employees
      .map((employee) => ({
        employee,
        score: latestScoreByEmployee.get(employee.id) ?? null,
        activeKpis: activeKpiCountByEmployee.get(employee.id) ?? 0,
        pending: pendingReviewCountByEmployee.get(employee.id) ?? 0,
      }))
      .filter((r) => r.score !== null || r.activeKpis > 0 || r.pending > 0);
  }, [employees, latestScoreByEmployee, activeKpiCountByEmployee, pendingReviewCountByEmployee]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q
      ? rows.filter((r) => `${r.employee.first_name} ${r.employee.last_name}`.toLowerCase().includes(q))
      : rows;
    if (statusFilter === "scored") filtered = filtered.filter((r) => r.score !== null);
    if (statusFilter === "not_scored") filtered = filtered.filter((r) => r.score === null);

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortColumn === "score") return ((a.score?.computed_score ?? -1) - (b.score?.computed_score ?? -1)) * dir;
      if (sortColumn === "activeKpis") return (a.activeKpis - b.activeKpis) * dir;
      if (sortColumn === "pending") return (a.pending - b.pending) * dir;
      return `${a.employee.first_name} ${a.employee.last_name}`.localeCompare(`${b.employee.first_name} ${b.employee.last_name}`) * dir;
    });
  }, [rows, search, statusFilter, sortColumn, sortDirection]);

  function toggleSort(column: PerformanceSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  if (loading) return <LoadingState label="Loading performance data..." />;
  if (error) return <ErrorBanner message="Some performance data failed to load. Try refreshing the page." />;

  const scoredRows = rows.filter((r) => r.score !== null);
  const averageScore =
    scoredRows.length > 0 ? scoredRows.reduce((sum, r) => sum + (r.score?.computed_score ?? 0), 0) / scoredRows.length : null;
  const totalPending = rows.reduce((sum, r) => sum + r.pending, 0);
  const totalActiveKpis = rows.reduce((sum, r) => sum + r.activeKpis, 0);

  return (
    <div className="flex flex-col gap-4">
      <StatStrip
        tiles={[
          { label: "Average Score", value: averageScore === null ? "—" : `${averageScore.toFixed(1)}%` },
          { label: "Scored", value: `${scoredRows.length} / ${rows.length}` },
          { label: "Active KPIs", value: String(totalActiveKpis) },
          { label: "Pending Reviews", value: String(totalPending) },
        ]}
      />

      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All" },
              { value: "scored", label: "Scored" },
              { value: "not_scored", label: "Not scored" },
            ]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Score" column="score" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader
              label="Active KPIs"
              column="activeKpis"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={toggleSort}
            />
            <SortHeader
              label="Pending reviews on this person's work"
              column="pending"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={toggleSort}
            />
          </TableHead>
          <tbody>
            {visibleRows.map((r) => (
              <Tr key={r.employee.id}>
                <Td className="text-text">
                  <EmployeeLink employeeId={r.employee.id} name={`${r.employee.first_name} ${r.employee.last_name}`} />
                </Td>
                <Td className="text-text-muted">
                  {r.score === null ? "—" : r.score.computed_score === null ? "No active KPIs" : `${r.score.computed_score}%`}
                </Td>
                <Td className="text-text-muted">{r.activeKpis}</Td>
                <Td className="text-text-muted">{r.pending}</Td>
              </Tr>
            ))}
            {visibleRows.length === 0 && (
              <TableEmptyRow
                colSpan={4}
                message={rows.length === 0 ? "No performance data within your scope yet." : "No employees match your search or filters."}
              />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tasks tab
// ----------------------------------------------------------------------------

const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-surface2 text-text-muted",
  in_progress: "bg-success-soft text-success",
  in_review: "bg-warning-soft text-warning",
  blocked: "bg-danger/10 text-danger",
  done: "bg-success-soft text-success",
  cancelled: "bg-surface2 text-text-dim",
};

function isTaskOverdue(task: Task): boolean {
  if (!task.due_date) return false;
  if (task.status === "done" || task.status === "cancelled") return false;
  return new Date(task.due_date) < new Date(new Date().toDateString());
}

type TaskSortColumn = "title" | "assignee" | "status" | "priority" | "due_date";

function TasksTab({
  tasks,
  employeeName,
  loading,
  error,
}: {
  tasks: Task[];
  employeeName: (id: string | null) => string;
  loading: boolean;
  error: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [sortColumn, setSortColumn] = useState<TaskSortColumn>("due_date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? tasks.filter((t) => t.title.toLowerCase().includes(q) || employeeName(t.assignee_employee_id).toLowerCase().includes(q))
      : tasks;
    if (statusFilter !== "all") rows = rows.filter((t) => t.status === statusFilter);

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "assignee") return employeeName(a.assignee_employee_id).localeCompare(employeeName(b.assignee_employee_id)) * dir;
      if (sortColumn === "status") return a.status.localeCompare(b.status) * dir;
      if (sortColumn === "priority") return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * dir;
      if (sortColumn === "due_date") return (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") * dir;
      return a.title.localeCompare(b.title) * dir;
    });
  }, [tasks, search, statusFilter, sortColumn, sortDirection, employeeName]);

  function toggleSort(column: TaskSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  if (loading) return <LoadingState label="Loading tasks..." />;
  if (error) return <ErrorBanner message="Tasks failed to load. Try refreshing the page." />;

  const overdueCount = tasks.filter(isTaskOverdue).length;
  const statusCounts = TASK_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: tasks.filter((t) => t.status === s).length }),
    {} as Record<TaskStatus, number>,
  );

  return (
    <div className="flex flex-col gap-4">
      <StatStrip
        tiles={[
          ...TASK_STATUSES.map((s) => ({ label: s.replace(/_/g, " "), value: String(statusCounts[s]) })),
          { label: "Overdue", value: String(overdueCount) },
        ]}
      />

      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search title or assignee..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...TASK_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Title" column="title" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Assignee" column="assignee" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Priority" column="priority" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Due date" column="due_date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
          </TableHead>
          <tbody>
            {visible.map((task) => (
              <Tr key={task.id}>
                <Td className="text-text">{task.title}</Td>
                <Td className="text-text-muted">
                  <EmployeeCell employeeId={task.assignee_employee_id} name={employeeName(task.assignee_employee_id)} />
                </Td>
                <Td>
                  <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${TASK_STATUS_STYLES[task.status]}`}>
                    {task.status.replace(/_/g, " ")}
                  </span>
                </Td>
                <Td className="text-text-muted">{task.priority}</Td>
                <Td className={isTaskOverdue(task) ? "font-medium text-danger" : "text-text-muted"}>
                  {task.due_date ?? "—"}
                  {isTaskOverdue(task) && " (overdue)"}
                </Td>
              </Tr>
            ))}
            {visible.length === 0 && (
              <TableEmptyRow colSpan={5} message={tasks.length === 0 ? "No tasks within your scope." : "No tasks match your search or filters."} />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Projects tab
// ----------------------------------------------------------------------------

const PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  planning: "bg-surface2 text-text-muted",
  active: "bg-success-soft text-success",
  on_hold: "bg-warning-soft text-warning",
  completed: "bg-success-soft text-success",
  cancelled: "bg-danger/10 text-danger",
};

function isProjectAtRisk(project: Project): boolean {
  if (!project.target_end_date) return false;
  if (project.status !== "planning" && project.status !== "active") return false;
  return new Date(project.target_end_date) < new Date(new Date().toDateString());
}

type ProjectSortColumn = "name" | "owner" | "status" | "priority" | "target_end_date";

function ProjectsTab({
  projects,
  employeeName,
  loading,
  error,
}: {
  projects: Project[];
  employeeName: (id: string | null) => string;
  loading: boolean;
  error: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [sortColumn, setSortColumn] = useState<ProjectSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? projects.filter((p) => p.name.toLowerCase().includes(q) || employeeName(p.owner_employee_id).toLowerCase().includes(q))
      : projects;
    if (statusFilter !== "all") rows = rows.filter((p) => p.status === statusFilter);

    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "owner") return employeeName(a.owner_employee_id).localeCompare(employeeName(b.owner_employee_id)) * dir;
      if (sortColumn === "status") return a.status.localeCompare(b.status) * dir;
      if (sortColumn === "priority") return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * dir;
      if (sortColumn === "target_end_date") return (a.target_end_date ?? "9999-12-31").localeCompare(b.target_end_date ?? "9999-12-31") * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [projects, search, statusFilter, sortColumn, sortDirection, employeeName]);

  function toggleSort(column: ProjectSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  if (loading) return <LoadingState label="Loading projects..." />;
  if (error) return <ErrorBanner message="Projects failed to load. Try refreshing the page." />;

  const statusCounts = PROJECT_STATUSES.reduce(
    (acc, s) => ({ ...acc, [s]: projects.filter((p) => p.status === s).length }),
    {} as Record<ProjectStatus, number>,
  );
  const atRiskCount = projects.filter(isProjectAtRisk).length;

  return (
    <div className="flex flex-col gap-4">
      <StatStrip
        tiles={[
          ...PROJECT_STATUSES.map((s) => ({ label: s.replace(/_/g, " "), value: String(statusCounts[s]) })),
          { label: "At risk", value: String(atRiskCount) },
        ]}
      />

      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name or owner..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Owner" column="owner" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Priority" column="priority" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader
              label="Target end date"
              column="target_end_date"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={toggleSort}
            />
          </TableHead>
          <tbody>
            {visible.map((project) => (
              <Tr key={project.id}>
                <Td className="text-text">{project.name}</Td>
                <Td className="text-text-muted">
                  <EmployeeCell employeeId={project.owner_employee_id} name={employeeName(project.owner_employee_id)} />
                </Td>
                <Td>
                  <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS_STYLES[project.status]}`}>
                    {project.status.replace(/_/g, " ")}
                  </span>
                </Td>
                <Td className="text-text-muted">{project.priority}</Td>
                <Td className={isProjectAtRisk(project) ? "font-medium text-danger" : "text-text-muted"}>
                  {project.target_end_date ?? "—"}
                  {isProjectAtRisk(project) && " (at risk)"}
                </Td>
              </Tr>
            ))}
            {visible.length === 0 && (
              <TableEmptyRow colSpan={5} message={projects.length === 0 ? "No projects within your scope." : "No projects match your search or filters."} />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Goals & KPIs tab -- three independent sub-sections. Individual goals key
// on employee_id (the person the goal is about); company/org_unit goals
// only have an optional owner_employee_id (who's driving it, a different
// concept -- see useEmployeeData.ts's own comment on this distinction).
// ----------------------------------------------------------------------------

const GOAL_STATUSES: GoalStatus[] = ["draft", "active", "completed", "archived", "cancelled"];

const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  draft: "bg-surface2 text-text-muted",
  active: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  archived: "bg-surface2 text-text-dim",
  cancelled: "bg-danger/10 text-danger",
};

const KPI_STATUSES: KpiStatus[] = ["active", "completed", "archived"];

const KPI_STATUS_STYLES: Record<KpiStatus, string> = {
  active: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  archived: "bg-surface2 text-text-dim",
};

function ratio(kpi: Kpi): number {
  if (kpi.direction === "higher_is_better") return kpi.target_value === 0 ? 0 : kpi.current_value / kpi.target_value;
  if (kpi.direction === "lower_is_better") return kpi.current_value === 0 ? 1 : kpi.target_value / kpi.current_value;
  return kpi.target_value === 0 ? 0 : 1 - Math.abs(kpi.current_value - kpi.target_value) / kpi.target_value;
}

function GoalsKpisTab({
  goals,
  kpis,
  employeeName,
  loading,
  error,
}: {
  goals: Goal[];
  kpis: Kpi[];
  employeeName: (id: string | null) => string;
  loading: boolean;
  error: boolean;
}) {
  if (loading) return <LoadingState label="Loading goals & KPIs..." />;
  if (error) return <ErrorBanner message="Goals & KPIs failed to load. Try refreshing the page." />;

  const individualGoals = goals.filter((g) => g.goal_type === "individual");
  const groupGoals = goals.filter((g) => g.goal_type !== "individual");

  return (
    <div className="flex flex-col gap-6">
      <IndividualGoalsSection goals={individualGoals} employeeName={employeeName} />
      <GroupGoalsSection goals={groupGoals} employeeName={employeeName} />
      <KpisSection kpis={kpis} employeeName={employeeName} />
    </div>
  );
}

type GoalSortColumn = "title" | "person" | "status" | "period";

function IndividualGoalsSection({ goals, employeeName }: { goals: Goal[]; employeeName: (id: string | null) => string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GoalStatus | "all">("all");
  const [sortColumn, setSortColumn] = useState<GoalSortColumn>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? goals.filter((g) => g.title.toLowerCase().includes(q) || employeeName(g.employee_id).toLowerCase().includes(q))
      : goals;
    if (statusFilter !== "all") rows = rows.filter((g) => g.status === statusFilter);
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "person") return employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)) * dir;
      if (sortColumn === "status") return a.status.localeCompare(b.status) * dir;
      if (sortColumn === "period") return a.period_start.localeCompare(b.period_start) * dir;
      return a.title.localeCompare(b.title) * dir;
    });
  }, [goals, search, statusFilter, sortColumn, sortDirection, employeeName]);

  function toggleSort(column: GoalSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Individual Goals</h2>
      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search title or person..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...GOAL_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Title" column="title" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Person" column="person" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Period" column="period" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
          </TableHead>
          <tbody>
            {visible.map((goal) => (
              <Tr key={goal.id}>
                <Td className="text-text">{goal.title}</Td>
                <Td className="text-text-muted">
                  <EmployeeCell employeeId={goal.employee_id} name={employeeName(goal.employee_id)} />
                </Td>
                <Td>
                  <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${GOAL_STATUS_STYLES[goal.status]}`}>{goal.status}</span>
                </Td>
                <Td className="text-text-muted">
                  {goal.period_start} to {goal.period_end}
                </Td>
              </Tr>
            ))}
            {visible.length === 0 && (
              <TableEmptyRow colSpan={4} message={goals.length === 0 ? "No individual goals within your scope." : "No goals match your search or filters."} />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

type GroupGoalSortColumn = "title" | "type" | "owner" | "status" | "period";

function GroupGoalsSection({ goals, employeeName }: { goals: Goal[]; employeeName: (id: string | null) => string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GoalStatus | "all">("all");
  const [sortColumn, setSortColumn] = useState<GroupGoalSortColumn>("title");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? goals.filter((g) => g.title.toLowerCase().includes(q) || employeeName(g.owner_employee_id).toLowerCase().includes(q))
      : goals;
    if (statusFilter !== "all") rows = rows.filter((g) => g.status === statusFilter);
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "type") return a.goal_type.localeCompare(b.goal_type) * dir;
      if (sortColumn === "owner") return employeeName(a.owner_employee_id).localeCompare(employeeName(b.owner_employee_id)) * dir;
      if (sortColumn === "status") return a.status.localeCompare(b.status) * dir;
      if (sortColumn === "period") return a.period_start.localeCompare(b.period_start) * dir;
      return a.title.localeCompare(b.title) * dir;
    });
  }, [goals, search, statusFilter, sortColumn, sortDirection, employeeName]);

  function toggleSort(column: GroupGoalSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Company & Org Unit Goals</h2>
      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search title or owner..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...GOAL_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Title" column="title" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Type" column="type" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Owner" column="owner" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Period" column="period" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
          </TableHead>
          <tbody>
            {visible.map((goal) => (
              <Tr key={goal.id}>
                <Td className="text-text">{goal.title}</Td>
                <Td>
                  <span className="rounded-edge-sm bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">{goal.goal_type}</span>
                </Td>
                <Td className="text-text-muted">
                  <EmployeeCell employeeId={goal.owner_employee_id} name={employeeName(goal.owner_employee_id)} />
                </Td>
                <Td>
                  <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${GOAL_STATUS_STYLES[goal.status]}`}>{goal.status}</span>
                </Td>
                <Td className="text-text-muted">
                  {goal.period_start} to {goal.period_end}
                </Td>
              </Tr>
            ))}
            {visible.length === 0 && (
              <TableEmptyRow
                colSpan={5}
                message={goals.length === 0 ? "No company/org unit goals within your scope." : "No goals match your search or filters."}
              />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

type KpiSortColumn = "name" | "person" | "progress" | "weight" | "status";

function KpisSection({ kpis, employeeName }: { kpis: Kpi[]; employeeName: (id: string | null) => string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<KpiStatus | "all">("all");
  const [sortColumn, setSortColumn] = useState<KpiSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? kpis.filter((k) => k.name.toLowerCase().includes(q) || employeeName(k.employee_id).toLowerCase().includes(q))
      : kpis;
    if (statusFilter !== "all") rows = rows.filter((k) => k.status === statusFilter);
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortColumn === "person") return employeeName(a.employee_id).localeCompare(employeeName(b.employee_id)) * dir;
      if (sortColumn === "progress") return (ratio(a) - ratio(b)) * dir;
      if (sortColumn === "weight") return (a.weight - b.weight) * dir;
      if (sortColumn === "status") return a.status.localeCompare(b.status) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [kpis, search, statusFilter, sortColumn, sortDirection, employeeName]);

  function toggleSort(column: KpiSortColumn) {
    if (sortColumn === column) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">KPIs</h2>
      <Card accent>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name or person..." />
          <StatusPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[{ value: "all", label: "All" }, ...KPI_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>
        <Table>
          <TableHead>
            <SortHeader label="Name" column="name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Person" column="person" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Progress" column="progress" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Weight" column="weight" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            <SortHeader label="Status" column="status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
          </TableHead>
          <tbody>
            {visible.map((kpi) => (
              <Tr key={kpi.id}>
                <Td className="text-text">{kpi.name}</Td>
                <Td className="text-text-muted">
                  <EmployeeCell employeeId={kpi.employee_id} name={employeeName(kpi.employee_id)} />
                </Td>
                <Td className="text-text-muted">
                  {kpi.current_value} / {kpi.target_value} {kpi.unit} · {Math.round(ratio(kpi) * 100)}%
                </Td>
                <Td className="text-text-muted">{kpi.weight}</Td>
                <Td>
                  <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${KPI_STATUS_STYLES[kpi.status]}`}>{kpi.status}</span>
                </Td>
              </Tr>
            ))}
            {visible.length === 0 && (
              <TableEmptyRow colSpan={5} message={kpis.length === 0 ? "No KPIs within your scope." : "No KPIs match your search or filters."} />
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
