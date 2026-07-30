import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Employee, Project, Task, TaskComment, TaskStatus, TaskStatusHistoryEntry } from "@/lib/types";

const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  todo: "bg-surface2 text-text-muted",
  in_progress: "bg-edge-teal/10 text-edge-teal",
  in_review: "bg-warning-soft text-warning",
  blocked: "bg-danger/10 text-danger",
  done: "bg-success-soft text-success",
  cancelled: "bg-surface2 text-text-dim",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function ErrorBanner({ message }: { message: string }) {
  return <p className="mt-2 rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

export default function Tasks() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [commentBody, setCommentBody] = useState("");

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<Employee>("/employees/me"),
    enabled: !!session,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", "assignee", meQuery.data?.id],
    queryFn: () => apiClient.get<Task[]>(`/tasks?assignee_employee_id=${meQuery.data?.id}`),
    enabled: !!meQuery.data,
  });

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => apiClient.get<Project[]>("/projects") });

  const selectedTask = tasksQuery.data?.find((t) => t.id === selectedTaskId) ?? null;

  const historyQuery = useQuery({
    queryKey: ["task-history", selectedTaskId],
    queryFn: () => apiClient.get<TaskStatusHistoryEntry[]>(`/tasks/${selectedTaskId}/history`),
    enabled: !!selectedTaskId,
  });

  const commentsQuery = useQuery({
    queryKey: ["task-comments", selectedTaskId],
    queryFn: () => apiClient.get<TaskComment[]>(`/tasks/${selectedTaskId}/comments`),
    enabled: !!selectedTaskId,
  });

  const createTask = useMutation({
    mutationFn: (payload: { title: string; project_id: string | null }) =>
      apiClient.post<Task>("/tasks", { ...payload, assignee_employee_id: meQuery.data?.id }),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "assignee", meQuery.data?.id] });
      setSelectedTaskId(task.id);
      setShowCreateForm(false);
    },
  });

  const updateTaskStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => apiClient.patch<Task>(`/tasks/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "assignee", meQuery.data?.id] });
      queryClient.invalidateQueries({ queryKey: ["task-history", selectedTaskId] });
    },
  });

  const addComment = useMutation({
    mutationFn: (body: string) => apiClient.post<TaskComment>(`/tasks/${selectedTaskId}/comments`, { body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", selectedTaskId] });
      setCommentBody("");
    },
  });

  function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    addComment.mutate(commentBody.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">My Tasks</h1>
          <p className="mt-1 text-sm text-text-muted">Tasks assigned to you, across every project and standalone.</p>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark"
        >
          + New task
        </button>
      </div>

      {showCreateForm && (
        <CreateTaskForm
          projects={projectsQuery.data ?? []}
          onSubmit={(payload) => createTask.mutate(payload)}
          pending={createTask.isPending}
          error={createTask.isError ? errorMessage(createTask.error) : null}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-edge-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(tasksQuery.data ?? []).map((task) => (
                <tr
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface2 ${
                    selectedTaskId === task.id ? "bg-nav-active" : ""
                  }`}
                >
                  <td className="px-4 py-2 text-text">{task.title}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {projectsQuery.data?.find((p) => p.id === task.project_id)?.name ?? "Standalone"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${TASK_STATUS_STYLES[task.status]}`}>
                      {task.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {tasksQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-dim">
                    No tasks assigned to you.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-edge-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedTask ? (
            <p className="text-sm text-text-dim">Select a task to see details.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">{selectedTask.title}</p>
                {selectedTask.description && <p className="mt-1 text-sm text-text-muted">{selectedTask.description}</p>}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Status</p>
                <select
                  value={selectedTask.status}
                  onChange={(e) => updateTaskStatus.mutate({ id: selectedTask.id, status: e.target.value as TaskStatus })}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {updateTaskStatus.isError && <ErrorBanner message={errorMessage(updateTaskStatus.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">History</p>
                <ul className="flex flex-col gap-1 text-sm text-text-muted">
                  {(historyQuery.data ?? []).map((entry) => (
                    <li key={entry.id}>
                      {entry.old_status ? `${entry.old_status.replace("_", " ")} -> ` : "created as "}
                      {entry.new_status.replace("_", " ")}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Comments</p>
                <ul className="flex flex-col gap-2">
                  {(commentsQuery.data ?? []).map((c) => (
                    <li key={c.id} className="rounded-edge-sm bg-surface2 px-2 py-1.5 text-sm text-text">
                      {c.body}
                    </li>
                  ))}
                  {commentsQuery.data?.length === 0 && <li className="text-sm text-text-dim">No comments yet.</li>}
                </ul>
                <form onSubmit={handleAddComment} className="mt-2 flex gap-2">
                  <input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Add a comment..."
                    className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
                  />
                  <button
                    type="submit"
                    disabled={addComment.isPending}
                    className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
                  >
                    Post
                  </button>
                </form>
                {addComment.isError && <ErrorBanner message={errorMessage(addComment.error)} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTaskForm({
  projects,
  onSubmit,
  pending,
  error,
}: {
  projects: Project[];
  onSubmit: (payload: { title: string; project_id: string | null }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), project_id: projectId || null });
    setTitle("");
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-edge-lg border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">Standalone (no project)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create task"}
      </button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
