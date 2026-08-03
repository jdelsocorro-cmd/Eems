import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Company, Employee, Project, Task, TaskCategory, TaskComment, TaskStatus, TaskStatusHistoryEntry } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel } from "@/components/ui";

const NEW_CATEGORY_VALUE = "__new__";

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
  const categoriesQuery = useQuery({
    queryKey: ["task-categories"],
    queryFn: () => apiClient.get<TaskCategory[]>("/task-categories"),
  });
  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });

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
    mutationFn: (payload: { title: string; project_id: string | null; task_category_id: string | null }) =>
      apiClient.post<Task>("/tasks", { ...payload, assignee_employee_id: meQuery.data?.id }),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "assignee", meQuery.data?.id] });
      setSelectedTaskId(task.id);
      setShowCreateForm(false);
    },
  });

  const createCategory = useMutation({
    mutationFn: (name: string) =>
      apiClient.post<TaskCategory>("/task-categories", { name, company_id: companiesQuery.data?.[0]?.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task-categories"] }),
  });

  const updateTaskStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => apiClient.patch<Task>(`/tasks/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "assignee", meQuery.data?.id] });
      queryClient.invalidateQueries({ queryKey: ["task-history", selectedTaskId] });
    },
  });

  const updateTaskCategory = useMutation({
    mutationFn: ({ id, task_category_id }: { id: string; task_category_id: string | null }) =>
      apiClient.patch<Task>(`/tasks/${id}`, { task_category_id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "assignee", meQuery.data?.id] }),
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
        <Button onClick={() => setShowCreateForm((v) => !v)}>+ New task</Button>
      </div>

      {showCreateForm && (
        <CreateTaskForm
          projects={projectsQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          onSubmit={(payload) => createTask.mutate(payload)}
          pending={createTask.isPending}
          error={createTask.isError ? errorMessage(createTask.error) : null}
          onCreateCategory={(name) => createCategory.mutateAsync(name)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Category</th>
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
                  <td className="px-4 py-2 text-text-muted">
                    {categoriesQuery.data?.find((c) => c.id === task.task_category_id)?.name ?? "—"}
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
                  <td colSpan={4} className="px-4 py-6 text-center text-text-dim">
                    No tasks assigned to you.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedTask ? (
            <EmptyState message="Select a task to see details." />
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
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Category</p>
                <select
                  value={selectedTask.task_category_id ?? ""}
                  onChange={(e) =>
                    updateTaskCategory.mutate({ id: selectedTask.id, task_category_id: e.target.value || null })
                  }
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  <option value="">Uncategorized</option>
                  {(categoriesQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {updateTaskCategory.isError && <ErrorBanner message={errorMessage(updateTaskCategory.error)} />}
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
                  <Button type="submit" disabled={addComment.isPending}>
                    Post
                  </Button>
                </form>
                {addComment.isError && <ErrorBanner message={errorMessage(addComment.error)} />}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CreateTaskForm({
  projects,
  categories,
  onSubmit,
  pending,
  error,
  onCreateCategory,
}: {
  projects: Project[];
  categories: TaskCategory[];
  onSubmit: (payload: { title: string; project_id: string | null; task_category_id: string | null }) => void;
  pending: boolean;
  error: string | null;
  onCreateCategory: (name: string) => Promise<TaskCategory>;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), project_id: projectId || null, task_category_id: categoryId || null });
    setTitle("");
  }

  function handleCategorySelect(value: string) {
    if (value === NEW_CATEGORY_VALUE) {
      setAddingCategory(true);
      return;
    }
    setCategoryId(value);
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setCreatingCategory(true);
    try {
      const category = await onCreateCategory(name);
      setCategoryId(category.id);
      setAddingCategory(false);
      setNewCategoryName("");
    } finally {
      setCreatingCategory(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-edge-lg bg-surface p-4 shadow-edge-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel>Task title</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fix invoice export bug"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <FieldLabel>Project</FieldLabel>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Standalone (no project)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Category</FieldLabel>
          {addingCategory ? (
            <div className="flex gap-1">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
              />
              <Button type="button" size="sm" disabled={creatingCategory} onClick={handleAddCategory}>
                Add
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategoryName("");
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <select
              value={categoryId}
              onChange={(e) => handleCategorySelect(e.target.value)}
              className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CATEGORY_VALUE}>+ Add new category...</option>
            </select>
          )}
        </div>
      </div>
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Creating..." : "Create task"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
