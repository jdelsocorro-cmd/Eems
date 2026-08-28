import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { OrgUnit, Position } from "@/lib/types";
import { ErrorBanner } from "@/components/ui";
import { PositionPicker } from "@/components/PositionPicker";

// Structurally matches EmployeeSidePanel.tsx / AssignConsultantPanel.tsx --
// fixed right-0 top-0 h-full max-w-[420px], backdrop, z-50. Reassignment
// itself is just POST /positions/{id}/reparent (positions.py:103-130),
// already gated by org_structure.manage and already writing a
// position_hierarchy_history row via a DB trigger that also rejects
// cycles -- this panel is a new entry point into an existing, audited
// endpoint, not new business logic. Not pre-filtering descendants out of
// the picker to block cycles client-side: the backend already rejects
// them safely and clearly, and duplicating that check here would be the
// same "guess instead of reject" complexity this codebase has
// deliberately avoided elsewhere (see bulk_import.py's _resolve_position).
export function ReassignManagerPanel({
  position,
  currentReportsToTitle,
  positions,
  units,
  onClose,
}: {
  position: Position;
  currentReportsToTitle: string | null;
  positions: Position[];
  units: OrgUnit[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reparent = useMutation({
    mutationFn: (newReportsToPositionId: string) =>
      apiClient.post<Position>(`/positions/${position.id}/reparent`, {
        new_reports_to_position_id: newReportsToPositionId,
        reason: "Reassigned via Organizational Chart",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      onClose();
    },
    onError: (err) => setSubmitError(errorMessage(err)),
  });

  // Can't report to itself -- everything else (including a would-be
  // descendant, which would create a cycle) is left to the backend's own
  // rejection, surfaced below via submitError.
  const pickablePositions = positions.filter((p) => p.id !== position.id);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-edge-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Reassign Manager</h2>
            <p className="mt-0.5 truncate text-sm font-semibold text-text">{position.title}</p>
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

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-3 text-xs text-text-dim">
            Currently reports to <span className="font-medium text-text">{currentReportsToTitle ?? "(root)"}</span>
          </p>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">New manager</p>
          <PositionPicker
            positions={pickablePositions}
            units={units}
            onAssign={(newReportsToPositionId) => {
              setSubmitError(null);
              reparent.mutate(newReportsToPositionId);
            }}
          />
          {reparent.isPending && <p className="mt-2 text-xs text-text-dim">Reassigning...</p>}
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
