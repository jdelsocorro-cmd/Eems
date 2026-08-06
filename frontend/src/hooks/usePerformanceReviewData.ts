import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type { CompletionSubmission, Employee, Goal, Kpi, KpiScore, Project, Task } from "@/lib/types";

// Performance Review Center's data layer -- every hook here calls its
// endpoint with NO scope parameter. tasks_select/projects_select/
// goals_select/kpis_select/kpi_scores_select/completion_submissions_select
// (040_employee_360_hierarchy_visibility.sql) already resolve "everything
// this caller can see" by combining RBAC grants at any scope type (self/
// position_subtree/org_unit/company, via accessible_employee_ids) with
// management-hierarchy visibility (hierarchy_subtree_employee_ids) -- so a
// plain unscoped GET already returns exactly the right per-caller set,
// automatically, for every scope type. No new backend code, no scope
// picker needed. `enabled` lets the page lazy-fetch per active tab, the
// same pattern useEmployeeData.ts uses for Employee 360.
//
// Deliberately NOT calling GET /scores/position-scores anywhere in this
// file (or anywhere in Performance Review Center) -- that table's RLS is
// scoped to company-level visibility (employee_accessible_company_ids,
// 033_position_score_rollup.sql:43-51), not subtree-level, so a manager
// holding only a position_subtree grant would see every position's score
// company-wide through it, not just their own subtree. GET /scores
// (kpi_scores) is the one that's actually subtree-scoped correctly.

export function useAllEmployees(enabled = true) {
  return useQuery({
    queryKey: ["employees"],
    queryFn: () => apiClient.get<Employee[]>("/employees"),
    enabled,
  });
}

export function useScopedTasks(enabled = true) {
  return useQuery({
    queryKey: ["tasks", "all-in-scope"],
    queryFn: () => apiClient.get<Task[]>("/tasks"),
    enabled,
  });
}

export function useScopedProjects(enabled = true) {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get<Project[]>("/projects"),
    enabled,
  });
}

export function useScopedGoals(enabled = true) {
  return useQuery({
    queryKey: ["goals"],
    queryFn: () => apiClient.get<Goal[]>("/goals"),
    enabled,
  });
}

export function useScopedKpis(enabled = true) {
  return useQuery({
    queryKey: ["kpis", "all-in-scope"],
    queryFn: () => apiClient.get<Kpi[]>("/kpis"),
    enabled,
  });
}

export function useScopedScores(enabled = true) {
  return useQuery({
    queryKey: ["scores", "all-in-scope"],
    queryFn: () => apiClient.get<KpiScore[]>("/scores"),
    enabled,
  });
}

export function useScopedCompletionSubmissions(enabled = true) {
  return useQuery({
    queryKey: ["completion-submissions", "all-in-scope"],
    queryFn: () => apiClient.get<CompletionSubmission[]>("/completion-submissions"),
    enabled,
  });
}
