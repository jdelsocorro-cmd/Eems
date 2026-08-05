import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { ApiError } from "@/lib/apiClient";
import type { CompletionSubmission, Kpi, Project, Recognition, Task } from "@/lib/types";
import { Button, Card, EmptyState, LoadingState } from "@/components/ui";
import {
  useEmployeeCompletionSubmissions,
  useEmployeeGoals,
  useEmployeeKpis,
  useEmployeeProfileSummary,
  useEmployeeProjects,
  useEmployeeRecognitions,
  useEmployeeScores,
  useEmployeeTasks,
} from "@/hooks/useEmployeeData";

type Tab = "overview" | "performance" | "tasks" | "projects" | "goals" | "recognition" | "activity";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "tasks", label: "Tasks" },
  { id: "projects", label: "Projects" },
  { id: "goals", label: "Goals & KPIs" },
  { id: "recognition", label: "Recognition" },
  { id: "activity", label: "Activity Timeline" },
];

// Read-only workspace for leaders: an employee's full performance picture
// in one place instead of navigating My Tasks / My Scorecard / Goals /
// Projects separately. Every tab reuses the exact same GET endpoints those
// self-service pages already call (useEmployeeData.ts), just parameterized
// by :employeeId instead of "me" -- visibility is entirely RLS's call
// (040_employee_360_hierarchy_visibility.sql's hierarchy_subtree_employee_
// ids, additive to any existing RBAC grant), never re-checked here. No
// mutation controls anywhere on this page -- editing stays on the
// self-service pages and RBAC-gated admin flows, exactly as decided in the
// architecture review this feature came out of.
export default function Employee360() {
  const { employeeId = "" } = useParams<{ employeeId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const needTasks = activeTab === "tasks" || activeTab === "activity";
  const needProjects = activeTab === "projects" || activeTab === "activity";
  const needGoals = activeTab === "goals";
  const needKpis = activeTab === "performance" || activeTab === "goals" || activeTab === "activity";
  const needScores = activeTab === "performance";
  const needRecognitions = activeTab === "recognition" || activeTab === "activity";
  const needSubmissions = activeTab === "activity";

  const profileQuery = useEmployeeProfileSummary(employeeId);
  const tasksQuery = useEmployeeTasks(employeeId, needTasks);
  const projectsQuery = useEmployeeProjects(employeeId, needProjects);
  const goalsQuery = useEmployeeGoals(employeeId, needGoals);
  const kpisQuery = useEmployeeKpis(employeeId, needKpis);
  const scoresQuery = useEmployeeScores(employeeId, needScores);
  const recognitionsQuery = useEmployeeRecognitions(employeeId, needRecognitions);
  const submissionsQuery = useEmployeeCompletionSubmissions(employeeId, needSubmissions);

  const notVisible = profileQuery.isError && profileQuery.error instanceof ApiError && profileQuery.error.status === 404;

  if (profileQuery.isLoading) {
    return <LoadingState label="Loading employee..." />;
  }

  if (notVisible || !profileQuery.data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-text">Employee 360</h1>
        <Card>
          <EmptyState message="Not found, or not visible to you. Employee 360 only shows employees within your organizational hierarchy." />
        </Card>
      </div>
    );
  }

  const profile = profileQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">
          {profile.first_name} {profile.last_name}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {profile.position_title ?? "No current position"}
          {profile.org_unit_name ? ` · ${profile.org_unit_name}` : ""} · Read-only
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <Button key={tab.id} variant="toolbar" size="sm" active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab profile={profile} />}
      {activeTab === "performance" && <PerformanceTab kpisQuery={kpisQuery} scoresQuery={scoresQuery} />}
      {activeTab === "tasks" && <TasksTab tasksQuery={tasksQuery} />}
      {activeTab === "projects" && <ProjectsTab projectsQuery={projectsQuery} />}
      {activeTab === "goals" && <GoalsTab goalsQuery={goalsQuery} kpisQuery={kpisQuery} />}
      {activeTab === "recognition" && <RecognitionTab recognitionsQuery={recognitionsQuery} />}
      {activeTab === "activity" && (
        <ActivityTab
          tasks={tasksQuery.data}
          projects={projectsQuery.data}
          kpis={kpisQuery.data}
          submissions={submissionsQuery.data}
          recognitions={recognitionsQuery.data}
          loading={tasksQuery.isLoading || projectsQuery.isLoading || kpisQuery.isLoading || submissionsQuery.isLoading || recognitionsQuery.isLoading}
        />
      )}
    </div>
  );
}

function OverviewTab({ profile }: { profile: NonNullable<ReturnType<typeof useEmployeeProfileSummary>["data"]> }) {
  return (
    <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Employee number" value={profile.employee_number ?? "—"} />
      <Field label="Work email" value={profile.work_email} />
      <Field label="Status" value={profile.status.replace("_", " ")} />
      <Field label="Hire date" value={profile.hire_date ?? "—"} />
      <Field label="Tenure" value={profile.tenure_days !== null ? `${Math.floor(profile.tenure_days / 365)}y ${Math.floor((profile.tenure_days % 365) / 30)}m` : "—"} />
      <Field label="Position" value={profile.position_title ?? "—"} />
      <Field label="Org unit" value={profile.org_unit_name ?? "—"} />
      <Field label="Manager" value={profile.manager ? `${profile.manager.first_name} ${profile.manager.last_name}` : "—"} />
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-text">{value}</p>
    </div>
  );
}

function ratio(kpi: Kpi): number {
  if (kpi.direction === "higher_is_better") return kpi.target_value === 0 ? 0 : kpi.current_value / kpi.target_value;
  if (kpi.direction === "lower_is_better") return kpi.current_value === 0 ? 1 : kpi.target_value / kpi.current_value;
  return kpi.target_value === 0 ? 0 : 1 - Math.abs(kpi.current_value - kpi.target_value) / kpi.target_value;
}

function PerformanceTab({
  kpisQuery,
  scoresQuery,
}: {
  kpisQuery: ReturnType<typeof useEmployeeKpis>;
  scoresQuery: ReturnType<typeof useEmployeeScores>;
}) {
  const activeKpis = (kpisQuery.data ?? []).filter((k) => k.status === "active");
  const latestScore = scoresQuery.data?.[0];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2">KPI</th>
              <th className="px-4 py-2">Progress</th>
              <th className="px-4 py-2">Weight</th>
            </tr>
          </thead>
          <tbody>
            {kpisQuery.isLoading && (
              <tr>
                <td colSpan={3}>
                  <LoadingState label="Loading KPIs..." />
                </td>
              </tr>
            )}
            {activeKpis.map((kpi) => (
              <tr key={kpi.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-text">
                  {kpi.name}
                  <span className="ml-1 text-xs text-text-dim">({kpi.direction.replace(/_/g, " ")})</span>
                </td>
                <td className="px-4 py-2 text-text-muted">
                  {kpi.current_value} / {kpi.target_value} {kpi.unit} · {Math.round(ratio(kpi) * 100)}%
                </td>
                <td className="px-4 py-2 text-text-muted">{kpi.weight}</td>
              </tr>
            ))}
            {!kpisQuery.isLoading && activeKpis.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-text-dim">
                  No active KPIs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Score</h2>
        {latestScore ? (
          <div className="mb-4">
            <p className="text-3xl font-semibold text-text">{latestScore.computed_score === null ? "--" : `${latestScore.computed_score}%`}</p>
            <p className="text-xs text-text-dim">
              {latestScore.period_start} to {latestScore.period_end}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-text-dim">No score computed yet.</p>
        )}
        {scoresQuery.data && scoresQuery.data.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">History</p>
            <ul className="flex flex-col gap-1 text-sm text-text-muted">
              {scoresQuery.data.map((s) => (
                <li key={s.id}>
                  {s.period_start} to {s.period_end}: {s.computed_score === null ? "No active KPIs" : `${s.computed_score}%`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

const TASK_STATUS_STYLES: Record<string, string> = {
  todo: "bg-surface2 text-text-muted",
  in_progress: "bg-warning-soft text-warning",
  in_review: "bg-warning-soft text-warning",
  completed: "bg-success-soft text-success",
  blocked: "bg-danger/10 text-danger",
};

function TasksTab({ tasksQuery }: { tasksQuery: ReturnType<typeof useEmployeeTasks> }) {
  if (tasksQuery.isLoading) return <LoadingState label="Loading tasks..." />;
  const tasks = tasksQuery.data ?? [];
  if (tasks.length === 0) return <EmptyState message="No tasks assigned." />;

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <Card key={task.id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">{task.title}</p>
            {task.due_date && <p className="text-xs text-text-dim">Due {task.due_date}</p>}
          </div>
          <span className={`shrink-0 rounded-edge-sm px-2 py-0.5 text-xs font-medium ${TASK_STATUS_STYLES[task.status] ?? "bg-surface2 text-text-muted"}`}>
            {task.status.replace(/_/g, " ")}
          </span>
        </Card>
      ))}
    </div>
  );
}

function ProjectsTab({ projectsQuery }: { projectsQuery: ReturnType<typeof useEmployeeProjects> }) {
  if (projectsQuery.isLoading) return <LoadingState label="Loading projects..." />;
  const projects = projectsQuery.data ?? [];
  if (projects.length === 0) return <EmptyState message="Owns no projects." />;

  return (
    <div className="flex flex-col gap-2">
      {projects.map((project) => (
        <Card key={project.id} className="flex items-center justify-between gap-3 p-3">
          <p className="truncate text-sm font-medium text-text">{project.name}</p>
          <span className="shrink-0 rounded-edge-sm bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">{project.status.replace(/_/g, " ")}</span>
        </Card>
      ))}
    </div>
  );
}

function GoalsTab({
  goalsQuery,
  kpisQuery,
}: {
  goalsQuery: ReturnType<typeof useEmployeeGoals>;
  kpisQuery: ReturnType<typeof useEmployeeKpis>;
}) {
  if (goalsQuery.isLoading) return <LoadingState label="Loading goals..." />;
  const goals = goalsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Goals</h2>
        {goals.length === 0 ? (
          <EmptyState message="Owns no goals." />
        ) : (
          <div className="flex flex-col gap-2">
            {goals.map((goal) => (
              <Card key={goal.id} className="flex items-center justify-between gap-3 p-3">
                <p className="truncate text-sm font-medium text-text">{goal.title}</p>
                <span className="shrink-0 rounded-edge-sm bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">{goal.status}</span>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">KPIs</h2>
        {kpisQuery.isLoading ? (
          <LoadingState label="Loading KPIs..." />
        ) : (kpisQuery.data ?? []).length === 0 ? (
          <EmptyState message="No KPIs." />
        ) : (
          <div className="flex flex-col gap-2">
            {(kpisQuery.data ?? []).map((kpi) => (
              <Card key={kpi.id} className="flex items-center justify-between gap-3 p-3">
                <p className="truncate text-sm font-medium text-text">{kpi.name}</p>
                <span className="shrink-0 text-xs text-text-muted">
                  {kpi.current_value} / {kpi.target_value} {kpi.unit}
                </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecognitionTab({ recognitionsQuery }: { recognitionsQuery: ReturnType<typeof useEmployeeRecognitions> }) {
  if (recognitionsQuery.isLoading) return <LoadingState label="Loading recognition..." />;
  const recognitions = recognitionsQuery.data ?? [];
  if (recognitions.length === 0) return <EmptyState message="No recognitions yet." />;

  return (
    <Card className="p-4">
      <ul className="flex flex-col gap-2">
        {recognitions.map((r) => (
          <li key={r.id} className="rounded-edge-sm bg-surface2 p-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-edge-sm bg-edge-teal/10 px-2 py-0.5 text-xs font-medium text-edge-teal">{r.category}</span>
              <span className="text-xs text-text-dim">{new Date(r.created_at).toLocaleDateString()}</span>
            </div>
            <p className="mt-1 text-text">{r.message}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface ActivityEvent {
  timestamp: string;
  label: string;
}

function buildActivityFeed(
  tasks: Task[] | undefined,
  projects: Project[] | undefined,
  kpis: Kpi[] | undefined,
  submissions: CompletionSubmission[] | undefined,
  recognitions: Recognition[] | undefined,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const task of tasks ?? []) {
    events.push({ timestamp: task.created_at, label: `Task created: ${task.title}` });
  }
  for (const project of projects ?? []) {
    events.push({ timestamp: project.created_at, label: `Project created: ${project.name}` });
  }
  for (const kpi of kpis ?? []) {
    events.push({ timestamp: kpi.created_at, label: `KPI defined: ${kpi.name}` });
  }
  for (const submission of submissions ?? []) {
    events.push({ timestamp: submission.submitted_at, label: `Submitted for review: ${submission.entity_type}` });
    if (submission.reviewed_at && submission.status !== "pending") {
      const outcome = submission.status === "approved" ? `approved (${submission.completion_score}%)` : "rejected";
      events.push({ timestamp: submission.reviewed_at, label: `Completion review ${outcome}: ${submission.entity_type}` });
    }
  }
  for (const recognition of recognitions ?? []) {
    events.push({ timestamp: recognition.created_at, label: `Recognized: ${recognition.category}` });
  }

  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function ActivityTab({
  tasks,
  projects,
  kpis,
  submissions,
  recognitions,
  loading,
}: {
  tasks: Task[] | undefined;
  projects: Project[] | undefined;
  kpis: Kpi[] | undefined;
  submissions: CompletionSubmission[] | undefined;
  recognitions: Recognition[] | undefined;
  loading: boolean;
}) {
  const feed = useMemo(() => buildActivityFeed(tasks, projects, kpis, submissions, recognitions), [tasks, projects, kpis, submissions, recognitions]);

  if (loading) return <LoadingState label="Loading activity..." />;
  if (feed.length === 0) return <EmptyState message="No activity yet." />;

  return (
    <Card className="p-4">
      <ul className="flex flex-col gap-2">
        {feed.map((event, i) => (
          <li key={i} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
            <span className="text-text">{event.label}</span>
            <span className="shrink-0 text-xs text-text-dim">{new Date(event.timestamp).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
