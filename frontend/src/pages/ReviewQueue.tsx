import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type { CompletionEntityType, CompletionSubmission, Employee, Milestone, Project, Task } from "@/lib/types";
import { Card, EmptyState, LoadingState } from "@/components/ui";
import { CompletionWorkflow } from "@/components/completion/CompletionWorkflow";

const ENTITY_LABELS: Record<CompletionEntityType, string> = { task: "Task", project: "Project", milestone: "Milestone" };

// Where an assigner (tasks) or owner's manager (projects/milestones) finds
// work that's actually waiting on THEM -- before this page existed, the
// only way to review a submission was to already know the exact task/
// project URL, since "My Tasks" only ever shows what's assigned TO you,
// never what you assigned to others. Backed by GET /completion-submissions
// ?awaiting_my_review=true, which mirrors completion_submissions_review's
// own reviewer-eligibility RLS so this list and "what I can actually
// approve" never drift apart.
export default function ReviewQueue() {
  const queryClient = useQueryClient();

  const submissionsQuery = useQuery({
    queryKey: ["completion-submissions", "awaiting-my-review"],
    queryFn: () => apiClient.get<CompletionSubmission[]>("/completion-submissions?awaiting_my_review=true"),
  });

  const tasksQuery = useQuery({ queryKey: ["tasks"], queryFn: () => apiClient.get<Task[]>("/tasks") });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => apiClient.get<Project[]>("/projects") });
  const milestonesQuery = useQuery({ queryKey: ["milestones"], queryFn: () => apiClient.get<Milestone[]>("/milestones") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });

  function entityName(sub: CompletionSubmission): string {
    if (sub.entity_type === "task") return tasksQuery.data?.find((t) => t.id === sub.entity_id)?.title ?? sub.entity_id;
    if (sub.entity_type === "project") return projectsQuery.data?.find((p) => p.id === sub.entity_id)?.name ?? sub.entity_id;
    return milestonesQuery.data?.find((m) => m.id === sub.entity_id)?.name ?? sub.entity_id;
  }

  const isLoading = submissionsQuery.isLoading || tasksQuery.isLoading || projectsQuery.isLoading || milestonesQuery.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Review Queue</h1>
        <p className="mt-1 text-sm text-text-muted">
          Tasks, projects, and milestones you assigned or own that are waiting on your review.
        </p>
      </div>

      {isLoading && <LoadingState label="Loading..." />}

      {!isLoading && (submissionsQuery.data ?? []).length === 0 && (
        <EmptyState message="Nothing waiting on your review right now." />
      )}

      <div className="flex flex-col gap-3">
        {(submissionsQuery.data ?? []).map((sub) => (
          <Card key={sub.id} className="p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
              {ENTITY_LABELS[sub.entity_type]}
            </p>
            <p className="mb-2 text-base font-medium text-text">{entityName(sub)}</p>
            <CompletionWorkflow
              entityType={sub.entity_type}
              entityId={sub.entity_id}
              employees={employeesQuery.data ?? []}
              submitPath={`/${sub.entity_type}s/${sub.entity_id}/submit-completion`}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["completion-submissions", "awaiting-my-review"] })}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
