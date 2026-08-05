import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { usePermissions } from "@/hooks/usePermissions";
import type { Employee, EmploymentType, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";
import { EmployeeLink } from "@/components/EmployeeLink";

const STATUS_STYLES: Record<Employee["status"], string> = {
  active: "bg-success-soft text-success",
  on_leave: "bg-warning-soft text-warning",
  offboarded: "bg-danger/10 text-danger",
};

// Consultant-facing labels -- deliberately only Full-Time/Part-Time are
// offered when setting this (the "contractor" value exists in the shared
// enum for positions.employment_type, but isn't a consultant classification
// EEMS collects here).
const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-Time Consultant",
  part_time: "Part-Time Consultant",
  contractor: "Contractor",
};
const CONSULTANT_EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "part_time"];

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { has } = usePermissions();
  const canManagePositions = has("org_structure", "manage");
  const canOffboard = has("employee", "update");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiClient.get<Employee[]>("/employees"),
  });

  const positionsQuery = useQuery({
    queryKey: ["positions"],
    queryFn: () => apiClient.get<Position[]>("/positions"),
  });

  const unitsQuery = useQuery({
    queryKey: ["org-units"],
    queryFn: () => apiClient.get<OrgUnit[]>("/org-units"),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["position-assignments", "current"],
    queryFn: () => apiClient.get<PositionAssignment[]>("/position-assignments?current_only=true"),
  });

  const selectedEmployee = employeesQuery.data?.find((e) => e.id === selectedEmployeeId) ?? null;
  const selectedAssignment = assignmentsQuery.data?.find((a) => a.employee_id === selectedEmployeeId) ?? null;
  const selectedPosition = positionsQuery.data?.find((p) => p.id === selectedAssignment?.position_id) ?? null;

  const createEmployee = useMutation({
    mutationFn: (payload: {
      first_name: string;
      last_name: string;
      work_email: string;
      send_invite: boolean;
      hire_date: string | null;
      employment_type: EmploymentType | null;
    }) => apiClient.post<Employee>("/employees", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const assignPosition = useMutation({
    mutationFn: (payload: { employee_id: string; position_id: string }) =>
      apiClient.post<PositionAssignment>("/position-assignments", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["position-assignments"] }),
  });

  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function handleProvisionEmployee(payload: {
    first_name: string;
    last_name: string;
    work_email: string;
    send_invite: boolean;
    hire_date: string | null;
    employment_type: EmploymentType | null;
    position_id: string | null;
  }) {
    setProvisionError(null);
    try {
      const { position_id, ...employeePayload } = payload;
      const employee = await createEmployee.mutateAsync(employeePayload);
      if (position_id) {
        await assignPosition.mutateAsync({ employee_id: employee.id, position_id });
      }
      setSelectedEmployeeId(employee.id);
      setShowCreateForm(false);
    } catch (err) {
      setProvisionError(errorMessage(err));
    }
  }

  const offboardEmployee = useMutation({
    mutationFn: (employeeId: string) => apiClient.post<Employee>(`/employees/${employeeId}/offboard`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["position-assignments"] });
    },
  });

  const [editingProfile, setEditingProfile] = useState(false);

  const updateEmployee = useMutation({
    mutationFn: ({ employeeId, ...payload }: { employeeId: string; hire_date: string | null; employment_type: EmploymentType | null }) =>
      apiClient.patch<Employee>(`/employees/${employeeId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setEditingProfile(false);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Users</h1>
          <p className="mt-1 text-sm text-text-muted">Manage employee records, position assignments, and offboarding.</p>
        </div>
        <Button onClick={() => setShowCreateForm((v) => !v)}>+ New employee</Button>
      </div>

      {showCreateForm && (
        <CreateEmployeeForm
          positions={positionsQuery.data ?? []}
          units={unitsQuery.data ?? []}
          onSubmit={handleProvisionEmployee}
          pending={createEmployee.isPending || assignPosition.isPending}
          error={provisionError}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {employeesQuery.isLoading && (
                <tr>
                  <td colSpan={3}>
                    <LoadingState label="Loading employees..." />
                  </td>
                </tr>
              )}
              {(employeesQuery.data ?? []).map((emp) => (
                <tr
                  key={emp.id}
                  onClick={() => {
                    setSelectedEmployeeId(emp.id);
                    setEditingProfile(false);
                  }}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface2 ${
                    selectedEmployeeId === emp.id ? "bg-nav-active" : ""
                  }`}
                >
                  <td className="px-4 py-2 text-text" onClick={(e) => e.stopPropagation()}>
                    <EmployeeLink employeeId={emp.id} name={`${emp.first_name} ${emp.last_name}`} />
                  </td>
                  <td className="px-4 py-2 text-text-muted">{emp.work_email}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[emp.status]}`}>
                      {emp.status}
                    </span>
                  </td>
                </tr>
              ))}
              {employeesQuery.data?.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-text-dim">
                    No employees yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Consultant Profile</h2>
          {!selectedEmployee ? (
            <EmptyState message="Select an employee to see their profile." />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">
                  {selectedEmployee.first_name} {selectedEmployee.last_name}
                </p>
                <span className={`mt-1 inline-block rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[selectedEmployee.status]}`}>
                  {selectedEmployee.status}
                </span>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Email</p>
                <p className="mt-1 text-sm text-text">{selectedEmployee.work_email}</p>
              </div>

              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Hire date &amp; employment type</p>
                  {selectedEmployee.status !== "offboarded" && !editingProfile && canOffboard && (
                    <button onClick={() => setEditingProfile(true)} className="text-xs text-edge-teal hover:underline">
                      Edit
                    </button>
                  )}
                </div>
                {editingProfile ? (
                  <ConsultantProfileEditForm
                    employee={selectedEmployee}
                    onSubmit={(payload) => updateEmployee.mutate({ employeeId: selectedEmployee.id, ...payload })}
                    onCancel={() => setEditingProfile(false)}
                    pending={updateEmployee.isPending}
                    error={updateEmployee.isError ? errorMessage(updateEmployee.error) : null}
                  />
                ) : (
                  <div className="mt-1 flex flex-col gap-0.5">
                    <p className="text-sm text-text">{selectedEmployee.hire_date ?? "Hire date not set"}</p>
                    <p className="text-sm text-text">
                      {selectedEmployee.employment_type ? EMPLOYMENT_TYPE_LABELS[selectedEmployee.employment_type] : "Employment type not set"}
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Current position</p>
                <p className="mt-1 text-sm text-text">{selectedPosition ? selectedPosition.title : "Unassigned"}</p>
              </div>

              {selectedEmployee.status !== "offboarded" && canManagePositions && (
                <div className="border-t border-border pt-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
                    {selectedPosition ? "Reassign position" : "Assign to position"}
                  </p>
                  <PositionPicker
                    positions={positionsQuery.data ?? []}
                    units={unitsQuery.data ?? []}
                    onAssign={(positionId) => assignPosition.mutate({ employee_id: selectedEmployee.id, position_id: positionId })}
                  />
                  {assignPosition.isError && <ErrorBanner message={errorMessage(assignPosition.error)} />}
                </div>
              )}

              {selectedEmployee.status !== "offboarded" && (
                <div className="border-t border-border pt-3">
                  <Button
                    variant="danger"
                    className="w-full border border-danger"
                    onClick={() => {
                      if (confirm(`Offboard ${selectedEmployee.first_name} ${selectedEmployee.last_name}?`)) {
                        offboardEmployee.mutate(selectedEmployee.id);
                      }
                    }}
                    disabled={offboardEmployee.isPending || !canOffboard}
                    title={canOffboard ? undefined : "You don't hold the employee.update permission needed to offboard someone."}
                  >
                    {offboardEmployee.isPending ? "Offboarding..." : "Offboard"}
                  </Button>
                  {offboardEmployee.isError && <ErrorBanner message={errorMessage(offboardEmployee.error)} />}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PositionPicker({
  positions,
  units,
  onAssign,
}: {
  positions: Position[];
  units: OrgUnit[];
  onAssign: (positionId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const unitsById = new Map(units.map((u) => [u.id, u]));

  const q = search.trim().toLowerCase();
  const filtered = q
    ? positions.filter((p) => `${p.title} ${unitsById.get(p.org_unit_id)?.name ?? ""}`.toLowerCase().includes(q))
    : positions;

  const grouped = new Map<string, Position[]>();
  for (const p of filtered) {
    const groupLabel = unitsById.get(p.org_unit_id)?.name ?? "Ungrouped";
    const list = grouped.get(groupLabel) ?? [];
    list.push(p);
    grouped.set(groupLabel, list);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter positions..."
        className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onAssign(e.target.value);
        }}
        className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="" disabled>
          Choose a position...
        </option>
        {[...grouped.entries()].map(([groupLabel, groupPositions]) => (
          <optgroup key={groupLabel} label={groupLabel}>
            {groupPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function ConsultantProfileEditForm({
  employee,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  employee: Employee;
  onSubmit: (payload: { hire_date: string | null; employment_type: EmploymentType | null }) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [hireDate, setHireDate] = useState(employee.hire_date ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(employee.employment_type ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ hire_date: hireDate || null, employment_type: employmentType || null });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-1.5">
      <input
        type="date"
        value={hireDate}
        onChange={(e) => setHireDate(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        value={employmentType}
        onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="">Employment type not set</option>
        {CONSULTANT_EMPLOYMENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {EMPLOYMENT_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function CreateEmployeeForm({
  positions,
  units,
  onSubmit,
  pending,
  error,
}: {
  positions: Position[];
  units: OrgUnit[];
  onSubmit: (payload: {
    first_name: string;
    last_name: string;
    work_email: string;
    send_invite: boolean;
    hire_date: string | null;
    employment_type: EmploymentType | null;
    position_id: string | null;
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [hireDate, setHireDate] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">("");
  const [positionId, setPositionId] = useState<string | null>(null);

  const selectedPosition = positions.find((p) => p.id === positionId) ?? null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      work_email: email.trim(),
      send_invite: sendInvite,
      hire_date: hireDate || null,
      employment_type: employmentType || null,
      position_id: positionId,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-edge-lg bg-surface p-4 shadow-edge-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Work email"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Hire date</p>
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Employment type</p>
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Not set</option>
            {CONSULTANT_EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
          Position (they'll be tied to this the moment they log in with the email above)
        </p>
        <PositionPicker positions={positions} units={units} onAssign={setPositionId} />
        <p className="mt-1 text-xs text-text-muted">
          {selectedPosition ? (
            <>
              Selected: <span className="font-medium text-text">{selectedPosition.title}</span>{" "}
              <button type="button" onClick={() => setPositionId(null)} className="text-edge-teal hover:underline">
                Clear
              </button>
            </>
          ) : (
            "No position selected -- you can assign one later, but it won't happen automatically."
          )}
        </p>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-text-muted">
        <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
        Send an email invite now (uncheck to pre-provision without inviting yet)
      </label>
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Creating..." : "Create employee"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
