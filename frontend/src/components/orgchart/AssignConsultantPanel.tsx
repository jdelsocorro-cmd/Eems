import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IconSearch } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Employee, EmploymentType, Position, PositionAssignment } from "@/lib/types";
import { Button, ErrorBanner } from "@/components/ui";

// Same set UserManagement.tsx's CreateEmployeeForm offers -- "contractor"
// exists in the shared positions.employment_type enum but isn't a
// consultant classification collected here either.
const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-Time Consultant",
  part_time: "Part-Time Consultant",
  contractor: "Contractor",
};
const CONSULTANT_EMPLOYMENT_TYPES: EmploymentType[] = ["full_time", "part_time"];

type Mode = "existing" | "new";

// Structurally matches EmployeeSidePanel.tsx (the app's one slide-in-panel
// precedent) -- fixed right-0 top-0 h-full max-w-[420px], backdrop, z-50.
// Owns its own mutations rather than reusing UserManagement.tsx's
// CreateEmployeeForm/PositionPicker -- those are entangled with that page's
// table/selection state, and extracting them would be an unrelated refactor.
export function AssignConsultantPanel({
  position,
  departmentName,
  reportsToTitle,
  directReportsCount,
  employees,
  currentPositionTitleByEmployee,
  canAssignExisting,
  canCreateNew,
  onClose,
}: {
  position: Position;
  departmentName: string;
  reportsToTitle: string | null;
  directReportsCount: number;
  employees: Employee[];
  currentPositionTitleByEmployee: Map<string, string>;
  canAssignExisting: boolean;
  canCreateNew: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(canAssignExisting ? "existing" : "new");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const assignPosition = useMutation({
    mutationFn: (payload: { employee_id: string; position_id: string }) =>
      apiClient.post<PositionAssignment>("/position-assignments", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["position-assignments"] }),
  });

  const createEmployee = useMutation({
    mutationFn: (payload: {
      first_name: string;
      last_name: string;
      work_email: string;
      send_invite: boolean;
      hire_date: string | null;
      employment_type: EmploymentType | null;
      phone: string | null;
      personal_email: string | null;
    }) => apiClient.post<Employee>("/employees", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  async function handleAssignExisting(employeeId: string) {
    setSubmitError(null);
    try {
      await assignPosition.mutateAsync({ employee_id: employeeId, position_id: position.id });
      onClose();
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  }

  async function handleCreateAndAssign(payload: {
    first_name: string;
    last_name: string;
    work_email: string;
    send_invite: boolean;
    hire_date: string | null;
    employment_type: EmploymentType | null;
    phone: string | null;
    personal_email: string | null;
  }) {
    setSubmitError(null);
    try {
      const employee = await createEmployee.mutateAsync(payload);
      await assignPosition.mutateAsync({ employee_id: employee.id, position_id: position.id });
      onClose();
    } catch (err) {
      setSubmitError(errorMessage(err));
    }
  }

  const pending = assignPosition.isPending || createEmployee.isPending;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-edge-lg">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium uppercase tracking-wide text-text-muted">
                {departmentName} &middot; Open Position
              </p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-text">Assign {position.title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-edge-sm px-2 py-1 text-text-muted hover:bg-surface2 hover:text-text"
            >
              ✕
            </button>
          </div>
          <p className="mt-1 text-xs text-text-dim">
            {reportsToTitle ? `Reports to ${reportsToTitle}` : "No manager"}
            {directReportsCount > 0 ? ` · ${directReportsCount} direct report${directReportsCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        {canAssignExisting && canCreateNew && (
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setMode("existing")}
              className={`flex-1 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                mode === "existing" ? "border-edge-teal text-text" : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              Existing Employee
            </button>
            <button
              type="button"
              onClick={() => setMode("new")}
              className={`flex-1 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                mode === "new" ? "border-edge-teal text-text" : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              New Consultant
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {mode === "existing" && canAssignExisting && (
            <ExistingEmployeeForm
              employees={employees}
              currentPositionTitleByEmployee={currentPositionTitleByEmployee}
              pending={pending}
              onAssign={handleAssignExisting}
            />
          )}
          {mode === "new" && canCreateNew && <NewConsultantForm pending={pending} onSubmit={handleCreateAndAssign} />}
          {submitError && (
            <div className="mt-3">
              <ErrorBanner message={submitError} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ExistingEmployeeForm({
  employees,
  currentPositionTitleByEmployee,
  pending,
  onAssign,
}: {
  employees: Employee[];
  currentPositionTitleByEmployee: Map<string, string>;
  pending: boolean;
  onAssign: (employeeId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? employees.filter((e) => `${e.first_name} ${e.last_name} ${e.work_email}`.toLowerCase().includes(q))
    : employees;

  const selectedCurrentPosition = selectedId ? currentPositionTitleByEmployee.get(selectedId) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <IconSearch size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employees..."
          className="w-full rounded-edge-sm border border-border bg-surface2 py-1.5 pl-7 pr-2 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-edge-sm border border-dashed border-border p-3 text-center text-xs text-text-dim">
          {employees.length === 0 ? "No employees available." : "No matches."}
        </p>
      ) : (
        <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "40vh" }}>
          {filtered.map((emp) => {
            const currentPosition = currentPositionTitleByEmployee.get(emp.id);
            return (
              <label
                key={emp.id}
                className={`flex cursor-pointer items-center gap-2 rounded-edge-sm border px-2.5 py-2 text-sm ${
                  selectedId === emp.id ? "border-edge-teal bg-edge-teal/5" : "border-border hover:bg-surface2"
                }`}
              >
                <input type="radio" name="existing-employee" checked={selectedId === emp.id} onChange={() => setSelectedId(emp.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">
                    {emp.first_name} {emp.last_name}
                  </span>
                  <span className="block truncate text-xs text-text-dim">{emp.work_email}</span>
                  {currentPosition && <span className="block truncate text-xs text-warning">Currently: {currentPosition}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {selectedCurrentPosition && (
        <p className="rounded-edge-sm border border-warning/30 bg-warning-soft px-2.5 py-2 text-xs text-warning">
          This will move them out of <span className="font-medium">{selectedCurrentPosition}</span>, leaving it vacant.
        </p>
      )}

      <Button type="button" disabled={!selectedId || pending} onClick={() => selectedId && onAssign(selectedId)}>
        {pending ? "Assigning..." : "Assign to position"}
      </Button>
    </div>
  );
}

function NewConsultantForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (payload: {
    first_name: string;
    last_name: string;
    work_email: string;
    send_invite: boolean;
    hire_date: string | null;
    employment_type: EmploymentType | null;
    phone: string | null;
    personal_email: string | null;
  }) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [hireDate, setHireDate] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">("");
  const [phone, setPhone] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");

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
      phone: phone.trim() || null,
      personal_email: personalEmail.trim() || null,
    });
  }

  const inputClass =
    "w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover";
  const labelClass = "mb-1 block text-xs font-medium uppercase tracking-wide text-text-muted";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className={labelClass}>First name</label>
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Last name</label>
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Work email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Hire date</label>
          <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Employment type</label>
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")} className={inputClass}>
            <option value="">Not set</option>
            {CONSULTANT_EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Phone (optional)</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Personal email (optional)</label>
        <input value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} type="email" className={inputClass} />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
        Send login invite email
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create & assign"}
      </Button>
    </form>
  );
}
