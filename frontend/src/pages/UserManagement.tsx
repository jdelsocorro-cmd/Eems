import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import type { Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";

const STATUS_STYLES: Record<Employee["status"], string> = {
  active: "bg-success-soft text-success",
  on_leave: "bg-warning-soft text-warning",
  offboarded: "bg-danger/10 text-danger",
};

export default function UserManagement() {
  const queryClient = useQueryClient();
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
    mutationFn: (payload: { first_name: string; last_name: string; work_email: string; send_invite: boolean }) =>
      apiClient.post<Employee>("/employees", payload),
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Users</h1>
          <p className="mt-1 text-sm text-text-muted">Manage employee records, position assignments, and offboarding.</p>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark"
        >
          + New employee
        </button>
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
        <div className="lg:col-span-2 rounded-edge-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(employeesQuery.data ?? []).map((emp) => (
                <tr
                  key={emp.id}
                  onClick={() => setSelectedEmployeeId(emp.id)}
                  className={`cursor-pointer border-b border-border last:border-0 hover:bg-surface2 ${
                    selectedEmployeeId === emp.id ? "bg-nav-active" : ""
                  }`}
                >
                  <td className="px-4 py-2 text-text">
                    {emp.first_name} {emp.last_name}
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
        </div>

        <div className="rounded-edge-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Details</h2>
          {!selectedEmployee ? (
            <p className="text-sm text-text-dim">Select an employee to see details.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">
                  {selectedEmployee.first_name} {selectedEmployee.last_name}
                </p>
                <p className="text-sm text-text-muted">{selectedEmployee.work_email}</p>
                <span className={`mt-1 inline-block rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[selectedEmployee.status]}`}>
                  {selectedEmployee.status}
                </span>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Current position</p>
                <p className="mt-1 text-sm text-text">{selectedPosition ? selectedPosition.title : "Unassigned"}</p>
              </div>

              {selectedEmployee.status !== "offboarded" && (
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
                  <button
                    onClick={() => {
                      if (confirm(`Offboard ${selectedEmployee.first_name} ${selectedEmployee.last_name}?`)) {
                        offboardEmployee.mutate(selectedEmployee.id);
                      }
                    }}
                    disabled={offboardEmployee.isPending}
                    className="w-full rounded-edge-sm border border-danger px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
                  >
                    {offboardEmployee.isPending ? "Offboarding..." : "Offboard"}
                  </button>
                  {offboardEmployee.isError && <ErrorBanner message={errorMessage(offboardEmployee.error)} />}
                </div>
              )}
            </div>
          )}
        </div>
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

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function ErrorBanner({ message }: { message: string }) {
  return <p className="mt-2 rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
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
    position_id: string | null;
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
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
      position_id: positionId,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-edge-lg border border-border bg-surface p-4">
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
      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create employee"}
      </button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
