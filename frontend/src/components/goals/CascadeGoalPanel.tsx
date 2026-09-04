import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Employee, Goal, GoalCascadeResult, KpiTemplate } from "@/lib/types";
import { Button, ErrorBanner } from "@/components/ui";

// Same slide-in-panel shape as AssignConsultantPanel/EmployeeSidePanel --
// the app's one established modal precedent, reused rather than inventing a
// second dialog pattern for this one feature.
export function CascadeGoalPanel({
  goal,
  employees,
  alreadyCoveredEmployeeIds,
  templates,
  onClose,
}: {
  goal: Goal;
  employees: Employee[];
  alreadyCoveredEmployeeIds: Set<string>;
  templates: KpiTemplate[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(employees.filter((e) => !alreadyCoveredEmployeeIds.has(e.id)).map((e) => e.id)),
  );
  const [templateId, setTemplateId] = useState("");
  const [result, setResult] = useState<GoalCascadeResult | null>(null);

  const cascade = useMutation({
    mutationFn: () =>
      apiClient.post<GoalCascadeResult>(`/goals/${goal.id}/cascade`, {
        employee_ids: [...selectedIds],
        kpi_template_id: templateId || null,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      setResult(data);
    },
  });

  function toggle(employeeId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-edge-lg">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium uppercase tracking-wide text-text-muted">Cascade to team</p>
              <h2 className="mt-0.5 truncate text-sm font-semibold text-text">{goal.title}</h2>
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
            Creates one individual goal per selected employee, linked back to this department goal. Already-covered
            employees are unchecked -- re-running this won't overwrite anything they've already got.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {result ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-edge-sm bg-success-soft px-3 py-2 text-sm text-success">
                Created {result.created.length} individual goal{result.created.length === 1 ? "" : "s"}
                {result.skipped_employee_ids.length > 0
                  ? ` — skipped ${result.skipped_employee_ids.length} already covered.`
                  : "."}
              </p>
              <Button onClick={onClose}>Done</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Employees</p>
                {employees.length === 0 ? (
                  <p className="rounded-edge-sm border border-dashed border-border p-3 text-center text-xs text-text-dim">
                    No employees in this department.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "40vh" }}>
                    {employees.map((emp) => {
                      const covered = alreadyCoveredEmployeeIds.has(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`flex items-center gap-2 rounded-edge-sm border px-2.5 py-2 text-sm ${
                            covered ? "cursor-not-allowed border-border opacity-50" : "cursor-pointer border-border hover:bg-surface2"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(emp.id)}
                            disabled={covered}
                            onChange={() => toggle(emp.id)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-text">
                              {emp.first_name} {emp.last_name}
                            </span>
                            {covered && <span className="block truncate text-xs text-text-dim">Already has a linked goal</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">KPI template (optional)</p>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
                >
                  <option value="">No KPI — I'll add targets myself</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-dim">
                  Each generated goal gets one KPI seeded from this template (name/unit/direction/weight). Target
                  starts at a placeholder -- set the real number per employee afterward, since one target rarely
                  fits everyone.
                </p>
              </div>

              {cascade.isError && <ErrorBanner message={errorMessage(cascade.error)} />}

              <Button disabled={selectedIds.size === 0 || cascade.isPending} onClick={() => cascade.mutate()}>
                {cascade.isPending ? "Creating..." : `Create ${selectedIds.size} goal${selectedIds.size === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
