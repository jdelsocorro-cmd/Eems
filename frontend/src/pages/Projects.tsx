import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Company, Employee, Project, ProjectMember, ProjectStatus, Task, TaskStatus } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel, InfoTooltip, LoadingState } from "@/components/ui";

const PROJECT_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];
const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  planning: "bg-surface2 text-text-muted",
  active: "bg-success-soft text-success",
  on_hold: "bg-warning-soft text-warning",
  completed: "bg-edge-teal/10 text-edge-teal",
  cancelled: "bg-danger/10 text-danger",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function employeeName(employees: Employee[] | undefined, id: string | null): string {
  if (!id) return "Unassigned";
  const emp = employees?.find((e) => e.id === id);
  return emp ? `${emp.first_name} ${emp.last_name}` : id;
}

const PROJECT_OWNER_TOOLTIP = (
  <p>
    The employee accountable for this project. Separate from <span className="font-medium text-edge-teal">members</span>{" "}
    below — owner is one person responsible for the project overall; members are everyone collaborating on it.
    Defaults to you if left unassigned.
  </p>
);

export default function Projects() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<Employee>("/employees/me"),
    enabled: !!session,
  });

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => apiClient.get<Project[]>("/projects") });
  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });

  const selectedProject = projectsQuery.data?.find((p) => p.id === selectedProjectId) ?? null;

  const membersQuery = useQuery({
    queryKey: ["project-members", selectedProjectId],
    queryFn: () => apiClient.get<ProjectMember[]>(`/projects/${selectedProjectId}/members`),
    enabled: !!selectedProjectId,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", "project", selectedProjectId],
    queryFn: () => apiClient.get<Task[]>(`/tasks?project_id=${selectedProjectId}`),
    enabled: !!selectedProjectId,
  });

  const createProject = useMutation({
    mutationFn: (payload: { company_id: string; name: string; priority: string; owner_employee_id: string | null }) =>
      apiClient.post<Project>("/projects", payload),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setShowCreateForm(false);
    },
  });

  const updateProjectStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectStatus }) =>
      apiClient.patch<Project>(`/projects/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const updateProjectOwner = useMutation({
    mutationFn: ({ id, owner_employee_id }: { id: string; owner_employee_id: string }) =>
      apiClient.patch<Project>(`/projects/${id}`, { owner_employee_id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const addMember = useMutation({
    mutationFn: (employeeId: string) =>
      apiClient.post<ProjectMember>(`/projects/${selectedProjectId}/members`, { employee_id: employeeId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-members", selectedProjectId] }),
  });

  const removeMember = useMutation({
    mutationFn: (employeeId: string) => apiClient.delete(`/projects/${selectedProjectId}/members/${employeeId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-members", selectedProjectId] }),
  });

  const createTask = useMutation({
    mutationFn: (payload: { title: string; assignee_employee_id: string }) =>
      apiClient.post<Task>("/tasks", { project_id: selectedProjectId, ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "project", selectedProjectId] }),
  });

  const updateTaskStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => apiClient.patch<Task>(`/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "project", selectedProjectId] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Projects</h1>
          <p className="mt-1 text-sm text-text-muted">Projects you own, are a member of, or hold company-wide visibility into.</p>
        </div>
        <Button onClick={() => setShowCreateForm((v) => !v)}>+ New project</Button>
      </div>

      {showCreateForm && (
        <CreateProjectForm
          companies={companiesQuery.data ?? []}
          employees={employeesQuery.data ?? []}
          defaultOwnerId={meQuery.data?.id ?? ""}
          onSubmit={(payload) => createProject.mutate(payload)}
          pending={createProject.isPending}
          error={createProject.isError ? errorMessage(createProject.error) : null}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {projectsQuery.isLoading && (
                <tr>
                  <td colSpan={3}>
                    <LoadingState label="Loading projects..." />
                  </td>
                </tr>
              )}
              {(projectsQuery.data ?? []).map((project) => (
                <tr
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface2 ${
                    selectedProjectId === project.id ? "bg-nav-active" : ""
                  }`}
                >
                  <td className="px-4 py-2 text-text">{project.name}</td>
                  <td className="px-4 py-2 text-text-muted">{employeeName(employeesQuery.data, project.owner_employee_id)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS_STYLES[project.status]}`}>
                      {project.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {projectsQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-dim">
                    No projects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedProject ? (
            <EmptyState message="Select a project to see details." />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">{selectedProject.name}</p>
                {selectedProject.description && <p className="mt-1 text-sm text-text-muted">{selectedProject.description}</p>}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Owner
                  <InfoTooltip content={PROJECT_OWNER_TOOLTIP} side="bottom" />
                </p>
                <select
                  value={selectedProject.owner_employee_id}
                  onChange={(e) => updateProjectOwner.mutate({ id: selectedProject.id, owner_employee_id: e.target.value })}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  {(employeesQuery.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
                {updateProjectOwner.isError && <ErrorBanner message={errorMessage(updateProjectOwner.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Status</p>
                <select
                  value={selectedProject.status}
                  onChange={(e) => updateProjectStatus.mutate({ id: selectedProject.id, status: e.target.value as ProjectStatus })}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                {updateProjectStatus.isError && <ErrorBanner message={errorMessage(updateProjectStatus.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Members</p>
                <ul className="flex flex-col gap-1">
                  {(membersQuery.data ?? []).map((m) => (
                    <li key={m.employee_id} className="flex items-center justify-between text-sm text-text">
                      <span>
                        {employeeName(employeesQuery.data, m.employee_id)} <span className="text-text-dim">({m.role_in_project})</span>
                      </span>
                      <button
                        onClick={() => removeMember.mutate(m.employee_id)}
                        className="text-xs text-danger hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  {membersQuery.data?.length === 0 && <li className="text-sm text-text-dim">No members yet.</li>}
                </ul>
                {removeMember.isError && <ErrorBanner message={errorMessage(removeMember.error)} />}
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addMember.mutate(e.target.value);
                      e.target.value = "";
                    }
                  }}
                  className="mt-2 w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  <option value="" disabled>
                    + Add member...
                  </option>
                  {(employeesQuery.data ?? [])
                    .filter((e) => !(membersQuery.data ?? []).some((m) => m.employee_id === e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.first_name} {e.last_name}
                      </option>
                    ))}
                </select>
                {addMember.isError && <ErrorBanner message={errorMessage(addMember.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Tasks</p>
                <ul className="flex flex-col gap-1">
                  {(tasksQuery.data ?? []).map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-2 text-sm text-text">
                      <span className="min-w-0 flex-1 truncate">{task.title}</span>
                      <span className="shrink-0 text-xs text-text-dim">
                        {employeeName(employeesQuery.data, task.assignee_employee_id)}
                      </span>
                      <select
                        value={task.status}
                        onChange={(e) => updateTaskStatus.mutate({ id: task.id, status: e.target.value as TaskStatus })}
                        className="rounded-edge-sm border border-border bg-surface2 px-1.5 py-0.5 text-xs text-text"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                  {tasksQuery.data?.length === 0 && <li className="text-sm text-text-dim">No tasks yet.</li>}
                </ul>
                {updateTaskStatus.isError && <ErrorBanner message={errorMessage(updateTaskStatus.error)} />}
                <NewTaskForm
                  employees={employeesQuery.data ?? []}
                  defaultAssigneeId={meQuery.data?.id ?? ""}
                  pending={createTask.isPending}
                  error={createTask.isError ? errorMessage(createTask.error) : null}
                  onSubmit={(title, assigneeId) => createTask.mutate({ title, assignee_employee_id: assigneeId })}
                />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CreateProjectForm({
  companies,
  employees,
  defaultOwnerId,
  onSubmit,
  pending,
  error,
}: {
  companies: Company[];
  employees: Employee[];
  defaultOwnerId: string;
  onSubmit: (payload: { company_id: string; name: string; priority: string; owner_employee_id: string | null }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !companyId) return;
    onSubmit({ name: name.trim(), company_id: companyId, priority, owner_employee_id: ownerId || null });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-edge-lg bg-surface p-4 shadow-edge-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <FieldLabel>Project name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q3 onboarding revamp"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <FieldLabel>Company</FieldLabel>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="" disabled>
              Choose a company...
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel tooltip={PROJECT_OWNER_TOOLTIP} tooltipSide="bottom">
            Owner
          </FieldLabel>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Priority</FieldLabel>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {["low", "medium", "high", "critical"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Creating..." : "Create project"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function NewTaskForm({
  employees,
  defaultAssigneeId,
  onSubmit,
  pending,
  error,
}: {
  employees: Employee[];
  defaultAssigneeId: string;
  onSubmit: (title: string, assigneeId: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !assigneeId) return;
    onSubmit(title.trim(), assigneeId);
    setTitle("");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task title"
        className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.first_name} {emp.last_name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
