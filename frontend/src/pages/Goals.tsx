import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type {
  Company,
  Employee,
  Goal,
  GoalStatus,
  GoalType,
  Kpi,
  KpiDirection,
  KpiMilestone,
  KpiProject,
  KpiTask,
  Milestone,
  OrgUnit,
  Project,
  Task,
} from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel, InfoTooltip, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";
import { EmployeeLink } from "@/components/EmployeeLink";

type EvidenceKind = "task" | "project" | "milestone";
const EVIDENCE_KINDS: EvidenceKind[] = ["task", "project", "milestone"];
const EVIDENCE_LABELS: Record<EvidenceKind, string> = { task: "Task", project: "Project", milestone: "Milestone" };

const GOAL_TYPES: GoalType[] = ["company", "org_unit", "individual"];
const GOAL_STATUSES: GoalStatus[] = ["draft", "active", "completed", "archived", "cancelled"];
const KPI_DIRECTIONS: KpiDirection[] = ["higher_is_better", "lower_is_better", "target_is_exact"];

const GOAL_TYPE_DESCRIPTIONS: Record<GoalType, string> = {
  company: "Applies to the whole organization — the top-level target that org-unit and individual goals can roll up into.",
  org_unit: "Applies to one org unit (a department or team) and everyone in it.",
  individual: "Applies to a single employee's personal goal.",
};

const GOAL_TYPE_LEGEND = (
  <div className="flex flex-col gap-1.5">
    <p className="font-semibold text-white">Goal scope</p>
    {GOAL_TYPES.map((t) => (
      <p key={t}>
        <span className="font-medium text-edge-teal">{t.replace("_", "-")}</span> — {GOAL_TYPE_DESCRIPTIONS[t]}
      </p>
    ))}
  </div>
);

const GOAL_STATUS_DESCRIPTIONS: Record<GoalStatus, string> = {
  draft: "Being set up — the default status for a new goal, before it's confirmed.",
  active: "Confirmed and currently in progress.",
  completed: "The goal has been achieved.",
  archived: "No longer relevant, but kept for the historical record.",
  cancelled: "Called off before completion.",
};

const GOAL_OWNER_TOOLTIP = (
  <p>
    The employee accountable for driving this goal forward. This is separate from the goal's{" "}
    <span className="font-medium text-edge-teal">type</span> — a company or org-unit goal has no natural single
    "target," but can still have an owner responsible for it. For individual goals, this usually matches the employee
    the goal is about, but doesn't have to.
  </p>
);

const GOAL_STATUS_LEGEND = (
  <div className="flex flex-col gap-1.5">
    <p className="font-semibold text-white">Goal status</p>
    {GOAL_STATUSES.map((s) => (
      <p key={s}>
        <span className="font-medium text-edge-teal">{s}</span> — {GOAL_STATUS_DESCRIPTIONS[s]}
      </p>
    ))}
  </div>
);

const KPI_UNIT_LEGEND = (
  <div className="flex flex-col gap-1.5">
    <p className="font-semibold text-white">Unit</p>
    <p>
      A free-text label for what the target and current values are measured in — e.g.{" "}
      <span className="font-medium text-edge-teal">count</span>, <span className="font-medium text-edge-teal">%</span>,{" "}
      <span className="font-medium text-edge-teal">hours</span>, <span className="font-medium text-edge-teal">$</span>. It's
      only a display label — the score is computed from the numeric values, not this text.
    </p>
  </div>
);

const KPI_DIRECTION_DESCRIPTIONS: Record<KpiDirection, string> = {
  higher_is_better: "Progress is good when the current value goes up (e.g. revenue, sessions completed).",
  lower_is_better: "Progress is good when the current value goes down (e.g. churn, error count).",
  target_is_exact: "Progress is best when the current value matches the target exactly.",
};

const KPI_DIRECTION_LEGEND = (
  <div className="flex flex-col gap-1.5">
    <p className="font-semibold text-white">Direction</p>
    {KPI_DIRECTIONS.map((d) => (
      <p key={d}>
        <span className="font-medium text-edge-teal">{d.replace(/_/g, " ")}</span> — {KPI_DIRECTION_DESCRIPTIONS[d]}
      </p>
    ))}
  </div>
);

const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  draft: "bg-surface2 text-text-muted",
  active: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  archived: "bg-surface2 text-text-dim",
  cancelled: "bg-danger/10 text-danger",
};

function employeeName(employees: Employee[] | undefined, id: string | null): string {
  if (!id) return "Unassigned";
  const emp = employees?.find((e) => e.id === id);
  return emp ? `${emp.first_name} ${emp.last_name}` : id;
}

export default function Goals() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<Employee>("/employees/me"),
    enabled: !!session,
  });

  const goalsQuery = useQuery({ queryKey: ["goals"], queryFn: () => apiClient.get<Goal[]>("/goals") });
  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });

  const selectedGoal = goalsQuery.data?.find((g) => g.id === selectedGoalId) ?? null;

  const kpisQuery = useQuery({
    queryKey: ["kpis", "goal", selectedGoalId],
    queryFn: () => apiClient.get<Kpi[]>(`/kpis?goal_id=${selectedGoalId}`),
    enabled: !!selectedGoalId,
  });

  const createGoal = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post<Goal>("/goals", payload),
    onSuccess: (goal) => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setSelectedGoalId(goal.id);
      setShowCreateForm(false);
    },
  });

  const updateGoalStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: GoalStatus }) => apiClient.patch<Goal>(`/goals/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });

  const updateGoalOwner = useMutation({
    mutationFn: ({ id, owner_employee_id }: { id: string; owner_employee_id: string | null }) =>
      apiClient.patch<Goal>(`/goals/${id}`, { owner_employee_id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["goals"] }),
  });

  const createKpi = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiClient.post<Kpi>("/kpis", { ...payload, goal_id: selectedGoalId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpis", "goal", selectedGoalId] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Goals & Performance</h1>
          <p className="mt-1 text-sm text-text-muted">Company, org-unit, and individual goals with cascading alignment.</p>
        </div>
        <Button onClick={() => setShowCreateForm((v) => !v)}>+ New goal</Button>
      </div>

      {showCreateForm && (
        <CreateGoalForm
          companies={companiesQuery.data ?? []}
          employees={employeesQuery.data ?? []}
          units={unitsQuery.data ?? []}
          defaultEmployeeId={meQuery.data?.id ?? ""}
          onSubmit={(payload) => createGoal.mutate(payload)}
          pending={createGoal.isPending}
          error={createGoal.isError ? errorMessage(createGoal.error) : null}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <TableHead>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Owner</Th>
              <Th>
                <span className="inline-flex items-center gap-1.5">
                  Status
                  <InfoTooltip content={GOAL_STATUS_LEGEND} side="bottom" />
                </span>
              </Th>
            </TableHead>
            <tbody>
              {goalsQuery.isLoading && (
                <tr>
                  <td colSpan={4}>
                    <LoadingState label="Loading goals..." />
                  </td>
                </tr>
              )}
              {(goalsQuery.data ?? []).map((goal) => (
                <Tr key={goal.id} onClick={() => setSelectedGoalId(goal.id)} selected={selectedGoalId === goal.id}>
                  <Td className="text-text">{goal.title}</Td>
                  <Td className="text-text-muted">{goal.goal_type}</Td>
                  <Td className="text-text-muted" onClick={(e) => e.stopPropagation()}>
                    {goal.owner_employee_id ? (
                      <EmployeeLink employeeId={goal.owner_employee_id} name={employeeName(employeesQuery.data, goal.owner_employee_id)} />
                    ) : (
                      employeeName(employeesQuery.data, goal.owner_employee_id)
                    )}
                  </Td>
                  <Td>
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${GOAL_STATUS_STYLES[goal.status]}`}>
                      {goal.status}
                    </span>
                  </Td>
                </Tr>
              ))}
              {goalsQuery.data?.length === 0 && <TableEmptyRow colSpan={4} message="No goals yet." />}
            </tbody>
          </Table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedGoal ? (
            <EmptyState message="Select a goal to see details." />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">{selectedGoal.title}</p>
                {selectedGoal.description && <p className="mt-1 text-sm text-text-muted">{selectedGoal.description}</p>}
                <p className="mt-1 text-xs text-text-dim">
                  {selectedGoal.period_start} to {selectedGoal.period_end}
                </p>
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Status
                  <InfoTooltip content={GOAL_STATUS_LEGEND} side="bottom" />
                </p>
                <select
                  value={selectedGoal.status}
                  onChange={(e) => updateGoalStatus.mutate({ id: selectedGoal.id, status: e.target.value as GoalStatus })}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  {GOAL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {updateGoalStatus.isError && <ErrorBanner message={errorMessage(updateGoalStatus.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Owner
                  <InfoTooltip content={GOAL_OWNER_TOOLTIP} side="bottom" />
                </p>
                <select
                  value={selectedGoal.owner_employee_id ?? ""}
                  onChange={(e) =>
                    updateGoalOwner.mutate({ id: selectedGoal.id, owner_employee_id: e.target.value || null })
                  }
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  <option value="">Unassigned</option>
                  {(employeesQuery.data ?? []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </option>
                  ))}
                </select>
                {updateGoalOwner.isError && <ErrorBanner message={errorMessage(updateGoalOwner.error)} />}
              </div>

              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Linked KPIs</p>
                <div className="flex flex-col gap-1.5">
                  {(kpisQuery.data ?? []).map((kpi) => (
                    <KpiRow key={kpi.id} kpi={kpi} />
                  ))}
                  {kpisQuery.data?.length === 0 && <EmptyState message="No KPIs linked yet." />}
                </div>
                {createKpi.isError && <ErrorBanner message={errorMessage(createKpi.error)} />}
                <NewKpiForm
                  employees={employeesQuery.data ?? []}
                  pending={createKpi.isPending}
                  onSubmit={(payload) => createKpi.mutate(payload)}
                />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CreateGoalForm({
  companies,
  employees,
  units,
  defaultEmployeeId,
  onSubmit,
  pending,
  error,
}: {
  companies: Company[];
  employees: Employee[];
  units: OrgUnit[];
  defaultEmployeeId: string;
  onSubmit: (payload: Record<string, unknown>) => void;
  pending: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [goalType, setGoalType] = useState<GoalType>("individual");
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [ownerEmployeeId, setOwnerEmployeeId] = useState(defaultEmployeeId);
  const [orgUnitId, setOrgUnitId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !companyId || !periodStart || !periodEnd) return;
    if (goalType === "org_unit" && !orgUnitId) return;
    const payload: Record<string, unknown> = {
      title: title.trim(),
      company_id: companyId,
      goal_type: goalType,
      owner_employee_id: ownerEmployeeId || null,
      period_start: periodStart,
      period_end: periodEnd,
    };
    if (goalType === "individual") payload.employee_id = employeeId;
    if (goalType === "org_unit") payload.org_unit_id = orgUnitId;
    onSubmit(payload);
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit}>
      <h3 className="mb-3 text-sm font-semibold text-text">New goal</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <FieldLabel>Goal title</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Expand account hours"
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
          <FieldLabel tooltip={GOAL_TYPE_LEGEND} tooltipSide="bottom">
            Goal type
          </FieldLabel>
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value as GoalType)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {GOAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", "-")}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-text-dim">{GOAL_TYPE_DESCRIPTIONS[goalType]}</p>
        </div>

        <div>
          <FieldLabel tooltip={GOAL_OWNER_TOOLTIP} tooltipSide="bottom">
            Owning employee
          </FieldLabel>
          <select
            value={ownerEmployeeId}
            onChange={(e) => setOwnerEmployeeId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Unassigned</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>
        </div>

        {goalType === "individual" && (
          <div>
            <FieldLabel>Employee</FieldLabel>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            >
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {goalType === "org_unit" && (
          <div>
            <FieldLabel>Org unit</FieldLabel>
            <select
              value={orgUnitId}
              onChange={(e) => setOrgUnitId(e.target.value)}
              className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            >
              <option value="" disabled>
                Choose a unit...
              </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.unit_type})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <FieldLabel>Start date</FieldLabel>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          />
        </div>

        <div>
          <FieldLabel>End date</FieldLabel>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Creating..." : "Create goal"}
      </Button>
      {error && <ErrorBanner message={error} />}
      </form>
    </Card>
  );
}

function NewKpiForm({
  employees,
  onSubmit,
  pending,
}: {
  employees: Employee[];
  onSubmit: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [unit, setUnit] = useState("");
  const [direction, setDirection] = useState<KpiDirection>("higher_is_better");
  const [targetValue, setTargetValue] = useState("");
  const [weight, setWeight] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !employeeId || !unit.trim() || !targetValue || !weight) return;
    onSubmit({
      name: name.trim(),
      employee_id: employeeId,
      unit: unit.trim(),
      direction,
      target_value: Number(targetValue),
      weight: Number(weight),
      period_start: new Date().toISOString().slice(0, 10),
      period_end: new Date(new Date().getFullYear(), 11, 31).toISOString().slice(0, 10),
    });
    setName("");
    setUnit("");
    setTargetValue("");
    setWeight("");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>KPI name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Monthly booked hours"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <FieldLabel>Owning employee</FieldLabel>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text"
          >
            <option value="" disabled>
              Choose an employee...
            </option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel tooltip={KPI_UNIT_LEGEND}>Unit</FieldLabel>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. count, %, hours"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <FieldLabel tooltip={KPI_DIRECTION_LEGEND}>Direction</FieldLabel>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as KpiDirection)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text"
          >
            {KPI_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel>Target value</FieldLabel>
          <input
            type="number"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="e.g. 100"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
          />
        </div>

        <div>
          <FieldLabel>Weight (0-100)</FieldLabel>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 25"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add KPI"}
      </Button>
    </form>
  );
}

function entityName(kind: EvidenceKind, id: string, tasks: Task[], projects: Project[], milestones: Milestone[]): string {
  if (kind === "task") return tasks.find((t) => t.id === id)?.title ?? id;
  if (kind === "project") return projects.find((p) => p.id === id)?.name ?? id;
  return milestones.find((m) => m.id === id)?.name ?? id;
}

function entityStatus(kind: EvidenceKind, id: string, tasks: Task[], projects: Project[], milestones: Milestone[]): string {
  if (kind === "task") return tasks.find((t) => t.id === id)?.status ?? "";
  if (kind === "project") return projects.find((p) => p.id === id)?.status ?? "";
  return milestones.find((m) => m.id === id)?.status ?? "";
}

// KPIs are evidence-driven now (031_kpi_links.sql) -- a KPI's current_value is
// a weighted average of the completion_score of whatever tasks/projects/
// milestones are linked to it. This section is where that linking happens,
// and it also doubles as a live readout of each linked item's status so the
// KPI's progress is traceable back to the actual work driving it.
function KpiRow({ kpi }: { kpi: Kpi }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [kind, setKind] = useState<EvidenceKind>("task");
  const [entityId, setEntityId] = useState("");
  const [weight, setWeight] = useState("1");

  const kpiTasksQuery = useQuery({
    queryKey: ["kpi-tasks", kpi.id],
    queryFn: () => apiClient.get<KpiTask[]>(`/kpis/${kpi.id}/tasks`),
    enabled: expanded,
  });
  const kpiProjectsQuery = useQuery({
    queryKey: ["kpi-projects", kpi.id],
    queryFn: () => apiClient.get<KpiProject[]>(`/kpis/${kpi.id}/projects`),
    enabled: expanded,
  });
  const kpiMilestonesQuery = useQuery({
    queryKey: ["kpi-milestones", kpi.id],
    queryFn: () => apiClient.get<KpiMilestone[]>(`/kpis/${kpi.id}/milestones`),
    enabled: expanded,
  });

  const allTasksQuery = useQuery({ queryKey: ["tasks"], queryFn: () => apiClient.get<Task[]>("/tasks"), enabled: expanded });
  const allProjectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => apiClient.get<Project[]>("/projects"), enabled: expanded });
  const allMilestonesQuery = useQuery({
    queryKey: ["milestones"],
    queryFn: () => apiClient.get<Milestone[]>("/milestones"),
    enabled: expanded,
  });

  function invalidateLinks() {
    queryClient.invalidateQueries({ queryKey: ["kpi-tasks", kpi.id] });
    queryClient.invalidateQueries({ queryKey: ["kpi-projects", kpi.id] });
    queryClient.invalidateQueries({ queryKey: ["kpi-milestones", kpi.id] });
    queryClient.invalidateQueries({ queryKey: ["kpis", "goal", kpi.goal_id] });
  }

  const link = useMutation({
    mutationFn: ({ kind, id, weight }: { kind: EvidenceKind; id: string; weight: number }) =>
      apiClient.post(`/kpis/${kpi.id}/${kind}s/${id}`, { weight }),
    onSuccess: () => {
      invalidateLinks();
      setEntityId("");
    },
  });

  const unlink = useMutation({
    mutationFn: ({ kind, id }: { kind: EvidenceKind; id: string }) =>
      apiClient.delete(`/kpis/${kpi.id}/${kind}s/${id}`),
    onSuccess: () => invalidateLinks(),
  });

  const tasks = allTasksQuery.data ?? [];
  const projects = allProjectsQuery.data ?? [];
  const milestones = allMilestonesQuery.data ?? [];

  const linkedItems: { kind: EvidenceKind; id: string; weight: number }[] = [
    ...(kpiTasksQuery.data ?? []).map((l) => ({ kind: "task" as const, id: l.task_id, weight: l.weight })),
    ...(kpiProjectsQuery.data ?? []).map((l) => ({ kind: "project" as const, id: l.project_id, weight: l.weight })),
    ...(kpiMilestonesQuery.data ?? []).map((l) => ({ kind: "milestone" as const, id: l.milestone_id, weight: l.weight })),
  ];

  const linkedIds = new Set(linkedItems.filter((i) => i.kind === kind).map((i) => i.id));
  const availableEntities: { id: string; label: string }[] =
    kind === "task"
      ? tasks.filter((t) => !linkedIds.has(t.id)).map((t) => ({ id: t.id, label: t.title }))
      : kind === "project"
        ? projects.filter((p) => !linkedIds.has(p.id)).map((p) => ({ id: p.id, label: p.name }))
        : milestones.filter((m) => !linkedIds.has(m.id)).map((m) => ({ id: m.id, label: m.name }));

  function handleLink(e: FormEvent) {
    e.preventDefault();
    if (!entityId || !weight) return;
    link.mutate({ kind, id: entityId, weight: Number(weight) });
  }

  return (
    <div className="rounded-edge-sm bg-surface2/50 p-2">
      <div className="flex items-center justify-between text-sm text-text">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1.5 text-left">
          <span className="text-text-dim">{expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span>
          <span>{kpi.name}</span>
        </button>
        <span className="text-text-muted">
          {kpi.current_value}/{kpi.target_value} {kpi.unit} &middot; w{kpi.weight}
        </span>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-dim">Evidence</p>
          <ul className="flex flex-col gap-1">
            {linkedItems.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-2 text-xs text-text">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-text-dim">[{EVIDENCE_LABELS[item.kind]}]</span>{" "}
                  {entityName(item.kind, item.id, tasks, projects, milestones)}{" "}
                  <span className="text-text-dim">
                    ({entityStatus(item.kind, item.id, tasks, projects, milestones).replace("_", " ")})
                  </span>
                </span>
                <span className="shrink-0 text-text-muted">w{item.weight}</span>
                <button
                  type="button"
                  onClick={() => unlink.mutate({ kind: item.kind, id: item.id })}
                  className="shrink-0 text-danger hover:underline"
                >
                  Unlink
                </button>
              </li>
            ))}
            {linkedItems.length === 0 && (
              <li>
                <EmptyState message="No evidence linked yet." />
              </li>
            )}
          </ul>
          {unlink.isError && <ErrorBanner message={errorMessage(unlink.error)} />}

          <form onSubmit={handleLink} className="mt-1 flex items-center gap-1">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as EvidenceKind);
                setEntityId("");
              }}
              className="rounded-edge-sm border border-border bg-surface px-1.5 py-1 text-xs text-text"
            >
              {EVIDENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EVIDENCE_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="min-w-0 flex-1 rounded-edge-sm border border-border bg-surface px-1.5 py-1 text-xs text-text"
            >
              <option value="" disabled>
                Choose {EVIDENCE_LABELS[kind].toLowerCase()}...
              </option>
              {availableEntities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className="w-14 rounded-edge-sm border border-border bg-surface px-1.5 py-1 text-xs text-text"
            />
            <Button type="submit" size="sm" disabled={link.isPending || !entityId}>
              Link
            </Button>
          </form>
          {link.isError && <ErrorBanner message={errorMessage(link.error)} />}
        </div>
      )}
    </div>
  );
}
