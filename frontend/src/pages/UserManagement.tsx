import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import type { Employee, Position, PositionAssignment, Team } from "@/lib/types";

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

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => apiClient.get<Team[]>("/teams"),
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
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelectedEmployeeId(employee.id);
      setShowCreateForm(false);
    },
  });

  const assignPosition = useMutation({
    mutationFn: (payload: { employee_id: string; position_id: string }) =>
      apiClient.post<PositionAssignment>("/position-assignments", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["position-assignments"] }),
  });

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
          onSubmit={(payload) => createEmployee.mutate(payload)}
          pending={createEmployee.isPending}
          error={createEmployee.isError ? errorMessage(createEmployee.error) : null}
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
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Assign to position</p>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        assignPosition.mutate({ employee_id: selectedEmployee.id, position_id: e.target.value });
                      }
                    }}
                    className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                  >
                    <option value="" disabled>
                      Choose a position...
                    </option>
                    {(positionsQuery.data ?? []).map((p) => {
                      const team = teamsQuery.data?.find((t) => t.id === p.team_id);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.title} {team ? `(${team.name})` : ""}
                        </option>
                      );
                    })}
                  </select>
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

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function ErrorBanner({ message }: { message: string }) {
  return <p className="mt-2 rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

function CreateEmployeeForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (payload: { first_name: string; last_name: string; work_email: string; send_invite: boolean }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    onSubmit({ first_name: firstName.trim(), last_name: lastName.trim(), work_email: email.trim(), send_invite: sendInvite });
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
