import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type {
  CompletionSubmission,
  EmployeeProfileSummary,
  Goal,
  Kpi,
  KpiScore,
  Project,
  Recognition,
  Task,
} from "@/lib/types";

// Employee 360's shared data layer -- every hook here is the same query the
// caller's own self-service pages already run (MyScorecard/Tasks/Goals/
// Projects), just parameterized by an arbitrary employeeId instead of "me".
// The backend endpoints already accept these filters unconditionally; RLS
// (040_employee_360_hierarchy_visibility.sql) is what actually decides
// whether the caller can see the target employee's rows at all -- an
// employeeId outside the caller's hierarchy/grants just comes back empty,
// not an error. `enabled` lets Employee360.tsx lazy-load per active tab
// instead of firing all 7 tabs' queries on mount (the pattern ReviewQueue.
// tsx's evidenceQuery already uses for the same reason).

export function useEmployeeProfileSummary(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-profile-summary", employeeId],
    queryFn: () => apiClient.get<EmployeeProfileSummary>(`/employees/${employeeId}/profile-summary`),
    enabled: enabled && !!employeeId,
    retry: false,
  });
}

export function useEmployeeTasks(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-tasks", employeeId],
    queryFn: () => apiClient.get<Task[]>(`/tasks?assignee_employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeProjects(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-projects", employeeId],
    queryFn: () => apiClient.get<Project[]>(`/projects?owner_employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeGoals(employeeId: string, enabled = true) {
  // employee_id, not owner_employee_id -- goals_select's individual-goal
  // visibility branch (and the new hierarchy branch added in 040) both key
  // on employee_id, the "this individual goal is about this person" column.
  // owner_employee_id is a separate "who's accountable for driving it"
  // column that also applies to company/org_unit goals and isn't what RLS
  // scopes hierarchy visibility on -- filtering by it here could show goals
  // RLS wouldn't otherwise let the caller see, or hide ones it would.
  return useQuery({
    queryKey: ["employee-goals", employeeId],
    queryFn: () => apiClient.get<Goal[]>(`/goals?employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeKpis(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-kpis", employeeId],
    queryFn: () => apiClient.get<Kpi[]>(`/kpis?employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeScores(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-scores", employeeId],
    queryFn: () => apiClient.get<KpiScore[]>(`/scores?employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeRecognitions(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-recognitions", employeeId],
    queryFn: () => apiClient.get<Recognition[]>(`/recognitions?employee_id=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}

export function useEmployeeCompletionSubmissions(employeeId: string, enabled = true) {
  return useQuery({
    queryKey: ["employee-completion-submissions", employeeId],
    queryFn: () => apiClient.get<CompletionSubmission[]>(`/completion-submissions?submitted_by=${employeeId}`),
    enabled: enabled && !!employeeId,
  });
}
