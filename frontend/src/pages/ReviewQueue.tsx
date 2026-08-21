import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronRight } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type {
  CompletionEntityType,
  CompletionEvidenceLink,
  CompletionSubmission,
  Employee,
  Milestone,
  Project,
  Task,
} from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";
import { CompletionWorkflow } from "@/components/completion/CompletionWorkflow";
import { EmployeeLink } from "@/components/EmployeeLink";

const ENTITY_LABELS: Record<CompletionEntityType, string> = { task: "Task", project: "Project", milestone: "Milestone" };

const REVIEWED_STATUS_STYLES: Record<"approved" | "rejected", string> = {
  approved: "bg-success-soft text-success",
  rejected: "bg-danger/10 text-danger",
};

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

  // Pending items never carry a score yet -- this is where a score/decision
  // I already gave stays visible afterward, since awaiting_my_review drops
  // an item the moment it's no longer pending.
  const reviewedQuery = useQuery({
    queryKey: ["completion-submissions", "reviewed-by-me"],
    queryFn: () => apiClient.get<CompletionSubmission[]>("/completion-submissions?reviewed_by_me=true"),
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
      {submissionsQuery.isError && <ErrorBanner message={errorMessage(submissionsQuery.error)} />}

      {!isLoading && !submissionsQuery.isError && (submissionsQuery.data ?? []).length === 0 && (
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
              onChanged={() => {
                queryClient.invalidateQueries({ queryKey: ["completion-submissions", "awaiting-my-review"] });
                queryClient.invalidateQueries({ queryKey: ["completion-submissions", "reviewed-by-me"] });
              }}
            />
          </Card>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">Recently Reviewed</h2>
        {reviewedQuery.isLoading && <LoadingState label="Loading..." />}
        {reviewedQuery.isError && <ErrorBanner message={errorMessage(reviewedQuery.error)} />}
        {!reviewedQuery.isLoading && !reviewedQuery.isError && (reviewedQuery.data ?? []).length === 0 && (
          <EmptyState message="You haven't reviewed anything yet." />
        )}
        <div className="flex flex-col gap-2">
          {(reviewedQuery.data ?? []).map((sub) => (
            <ReviewedEntry
              key={sub.id}
              submission={sub}
              entityLabel={ENTITY_LABELS[sub.entity_type]}
              entityName={entityName(sub)}
              employees={employeesQuery.data ?? []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewedEntry({
  submission,
  entityLabel,
  entityName,
  employees,
}: {
  submission: CompletionSubmission;
  entityLabel: string;
  entityName: string;
  employees: Employee[];
}) {
  const [expanded, setExpanded] = useState(false);

  const evidenceQuery = useQuery({
    queryKey: ["completion-evidence", submission.id],
    queryFn: () => apiClient.get<CompletionEvidenceLink[]>(`/completion-submissions/${submission.id}/evidence-links`),
    enabled: expanded,
  });

  const submitterName = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.first_name} ${emp.last_name}` : id;
  };

  const submitterLink = (id: string) => <EmployeeLink employeeId={id} name={submitterName(id)} />;

  const status = submission.status as "approved" | "rejected";

  return (
    <Card className="p-3">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="flex min-w-0 items-center gap-2 text-sm text-text">
          <span className={`shrink-0 rounded-edge-sm px-2 py-0.5 text-xs font-medium ${REVIEWED_STATUS_STYLES[status]}`}>
            {submission.status}
          </span>
          <span className="text-text-dim">{entityLabel}:</span>
          <span className="truncate font-medium">{entityName}</span>
        </span>
        <span className="shrink-0 text-xs text-text-dim">
          {status === "approved" ? `${submission.completion_score}%` : <IconChevronRight size={13} />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-xs text-text">
          <p>{submission.summary}</p>
          <p className="text-text-dim">
            Submitted by {submitterLink(submission.submitted_by)} &middot; {new Date(submission.submitted_at).toLocaleDateString()}
          </p>
          {status === "rejected" && submission.rejection_feedback && (
            <p className="text-danger">Feedback: {submission.rejection_feedback}</p>
          )}
          {(evidenceQuery.data ?? []).length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {(evidenceQuery.data ?? []).map((link) => (
                <li key={link.id}>
                  <a href={link.url} target="_blank" rel="noreferrer" className="text-edge-teal hover:underline">
                    {link.label || link.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
