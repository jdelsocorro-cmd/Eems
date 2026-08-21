import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { CompletionEntityType, CompletionEvidenceLink, CompletionSubmission, Employee, Recognition } from "@/lib/types";
import { Button, ErrorBanner, FieldLabel } from "@/components/ui";

const STATUS_STYLES: Record<CompletionSubmission["status"], string> = {
  pending: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  rejected: "bg-danger/10 text-danger",
};

// Shared by Tasks, Projects, and Milestones -- all three need the identical
// submit -> review -> approve/reject workflow (same shape everywhere per
// 030_completion_workflow.sql), so this lives once instead of being
// triplicated with entity-specific plumbing.
export function CompletionWorkflow({
  entityType,
  entityId,
  employees,
  submitPath,
  onChanged,
}: {
  entityType: CompletionEntityType;
  entityId: string;
  employees: Employee[];
  submitPath: string;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [pendingLinks, setPendingLinks] = useState<{ url: string; label: string }[]>([]);
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>({});
  const [feedbackInputs, setFeedbackInputs] = useState<Record<string, string>>({});
  const [recognitionPromptId, setRecognitionPromptId] = useState<string | null>(null);
  const [recognitionMessage, setRecognitionMessage] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const submissionsQuery = useQuery({
    queryKey: ["completion-submissions", entityType, entityId],
    queryFn: () => apiClient.get<CompletionSubmission[]>(`/completion-submissions?entity_type=${entityType}&entity_id=${entityId}`),
    enabled: !!entityId,
  });

  const latest = submissionsQuery.data?.[0] ?? null;
  const hasPending = latest?.status === "pending";

  const evidenceQuery = useQuery({
    queryKey: ["completion-evidence", latest?.id],
    queryFn: () => apiClient.get<CompletionEvidenceLink[]>(`/completion-submissions/${latest?.id}/evidence-links`),
    enabled: !!latest,
  });

  const submit = useMutation({
    mutationFn: () =>
      apiClient.post<CompletionSubmission>(submitPath, {
        summary,
        evidence_links: pendingLinks.map((l) => ({ url: l.url, label: l.label || null })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completion-submissions", entityType, entityId] });
      setSummary("");
      setPendingLinks([]);
      onChanged?.();
    },
  });

  const approve = useMutation({
    mutationFn: ({ id, completion_score }: { id: string; completion_score: number }) =>
      apiClient.post<CompletionSubmission>(`/completion-submissions/${id}/approve`, { completion_score }),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["completion-submissions", entityType, entityId] });
      onChanged?.();
      try {
        const suggested = await apiClient.get<boolean>(`/completion-submissions/${variables.id}/recognition-suggested`);
        if (suggested) setRecognitionPromptId(variables.id);
      } catch {
        // Non-critical -- the recognition prompt is a nice-to-have, not worth surfacing an error for.
      }
    },
  });

  const giveRecognition = useMutation({
    mutationFn: () =>
      apiClient.post<Recognition>("/recognitions", {
        employee_id: latest!.submitted_by,
        category: "kudos",
        message: recognitionMessage.trim() || `Great work -- ${latest!.completion_score}% completion.`,
        related_entity_type: entityType,
        related_entity_id: entityId,
      }),
    onSuccess: () => {
      setRecognitionPromptId(null);
      setRecognitionMessage("");
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, rejection_feedback }: { id: string; rejection_feedback: string }) =>
      apiClient.post<CompletionSubmission>(`/completion-submissions/${id}/reject`, { rejection_feedback }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["completion-submissions", entityType, entityId] });
      onChanged?.();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    submit.mutate();
  }

  function handleAddLink() {
    if (!linkUrl.trim()) return;
    setPendingLinks((prev) => [...prev, { url: linkUrl.trim(), label: linkLabel.trim() }]);
    setLinkUrl("");
    setLinkLabel("");
  }

  const submitterName = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    return emp ? `${emp.first_name} ${emp.last_name}` : id;
  };

  // submissionsQuery already returns the full history (submitted_at desc) --
  // everything after the latest (index 0) is a prior attempt, e.g. a
  // rejected submission that got resubmitted. Kept out of the main panel by
  // default so it doesn't clutter the common case of "one submission, done".
  const priorSubmissions = (submissionsQuery.data ?? []).slice(1);

  return (
    <div className="border-t border-border pt-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Completion</p>

      {latest && (
        <div className="mb-3 flex flex-col gap-1.5 rounded-edge-sm bg-surface2 p-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[latest.status]}`}>{latest.status}</span>
            <span className="text-xs text-text-dim">by {submitterName(latest.submitted_by)}</span>
          </div>
          <p className="text-text">{latest.summary}</p>
          {(evidenceQuery.data ?? []).length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {(evidenceQuery.data ?? []).map((link) => (
                <li key={link.id} className="text-xs">
                  <a href={link.url} target="_blank" rel="noreferrer" className="text-edge-teal hover:underline">
                    {link.label || link.url}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {latest.status === "approved" && latest.completion_score !== null && (
            <p className="text-xs text-text-muted">Score: {latest.completion_score}%</p>
          )}
          {latest.status === "rejected" && latest.rejection_feedback && (
            <p className="text-xs text-danger">Feedback: {latest.rejection_feedback}</p>
          )}

          {hasPending && (
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Score 0-100"
                  value={scoreInputs[latest.id] ?? ""}
                  onChange={(e) => setScoreInputs((prev) => ({ ...prev, [latest.id]: e.target.value }))}
                  className="w-24 rounded-edge-sm border border-border bg-surface px-2 py-1 text-xs text-text"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={approve.isPending || !scoreInputs[latest.id]}
                  onClick={() => approve.mutate({ id: latest.id, completion_score: Number(scoreInputs[latest.id]) })}
                >
                  Approve
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  placeholder="Rejection feedback"
                  value={feedbackInputs[latest.id] ?? ""}
                  onChange={(e) => setFeedbackInputs((prev) => ({ ...prev, [latest.id]: e.target.value }))}
                  className="flex-1 rounded-edge-sm border border-border bg-surface px-2 py-1 text-xs text-text"
                />
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={reject.isPending || !feedbackInputs[latest.id]?.trim()}
                  onClick={() => reject.mutate({ id: latest.id, rejection_feedback: feedbackInputs[latest.id] })}
                >
                  Reject
                </Button>
              </div>
              <p className="text-[11px] leading-snug text-text-dim">
                Only the assigner/owner or their manager can approve or reject -- this will fail harmlessly if you're not authorized to review it.
              </p>
            </div>
          )}
          {approve.isError && <ErrorBanner message={errorMessage(approve.error)} />}
          {reject.isError && <ErrorBanner message={errorMessage(reject.error)} />}

          {recognitionPromptId && latest.id === recognitionPromptId && latest.status === "approved" && (
            <div className="mt-1 flex flex-col gap-1.5 rounded-edge-sm border border-edge-teal/40 bg-edge-teal/5 p-2">
              <p className="text-xs font-medium text-edge-teal">
                High score! Recognize {submitterName(latest.submitted_by)} for this?
              </p>
              <textarea
                value={recognitionMessage}
                onChange={(e) => setRecognitionMessage(e.target.value)}
                placeholder="Optional message"
                rows={2}
                className="w-full rounded-edge-sm border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
              />
              <div className="flex gap-1.5">
                <Button type="button" size="sm" disabled={giveRecognition.isPending} onClick={() => giveRecognition.mutate()}>
                  Recognize
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setRecognitionPromptId(null)}>
                  Dismiss
                </Button>
              </div>
              {giveRecognition.isError && <ErrorBanner message={errorMessage(giveRecognition.error)} />}
            </div>
          )}
        </div>
      )}

      {priorSubmissions.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-edge-teal hover:underline"
          >
            {showHistory ? "Hide" : "View"} completion history ({priorSubmissions.length})
          </button>
          {showHistory && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {priorSubmissions.map((sub) => (
                <HistoryEntry key={sub.id} submission={sub} submitterName={submitterName} />
              ))}
            </ul>
          )}
        </div>
      )}

      {!hasPending && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
          <FieldLabel>Submit for review</FieldLabel>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What did you do? (required)"
            rows={2}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
          {pendingLinks.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {pendingLinks.map((l, i) => (
                <li key={i} className="text-xs text-text-muted">
                  {l.label || l.url}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-1">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Evidence link (optional)"
              className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
            />
            <input
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              placeholder="Label"
              className="w-24 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleAddLink}>
              + Add
            </Button>
          </div>
          <Button type="submit" size="sm" disabled={submit.isPending || !summary.trim()} className="self-start">
            {submit.isPending ? "Submitting..." : "Submit for review"}
          </Button>
          {submit.isError && <ErrorBanner message={errorMessage(submit.error)} />}
        </form>
      )}
    </div>
  );
}

// Evidence links are fetched lazily (only once this specific history entry
// is expanded), not for every prior submission up front -- avoids an N+1
// burst of evidence-link requests for an entity with a long rejection trail.
function HistoryEntry({
  submission,
  submitterName,
}: {
  submission: CompletionSubmission;
  submitterName: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  const evidenceQuery = useQuery({
    queryKey: ["completion-evidence", submission.id],
    queryFn: () => apiClient.get<CompletionEvidenceLink[]>(`/completion-submissions/${submission.id}/evidence-links`),
    enabled: expanded,
  });

  return (
    <li className="rounded-edge-sm bg-surface2 p-2 text-xs">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-1.5">
          <span className={`rounded-edge-sm px-1.5 py-0.5 font-medium ${STATUS_STYLES[submission.status]}`}>{submission.status}</span>
          <span className="text-text-dim">{new Date(submission.submitted_at).toLocaleDateString()}</span>
        </span>
        <span className="text-text-dim">{expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 text-text">
          <p>{submission.summary}</p>
          <p className="text-text-dim">by {submitterName(submission.submitted_by)}</p>
          {submission.status === "approved" && submission.completion_score !== null && <p>Score: {submission.completion_score}%</p>}
          {submission.status === "rejected" && submission.rejection_feedback && (
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
    </li>
  );
}
