import { Link } from "react-router-dom";

import { EmployeeProfileBody } from "@/components/employee360/EmployeeProfileBody";

// No Modal/Drawer/Sheet component exists anywhere in this app to reuse
// (checked -- the only fixed/z-50 precedent is ReportProblemButton's
// centered modal) -- this is a from-scratch slide-in-from-right panel.
// z-50 matches that one existing overlay's z-index; the two are never open
// at the same time so there's no stacking conflict to resolve.
export function EmployeeSidePanel({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-edge-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Employee Profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-edge-sm px-2 py-1 text-text-muted hover:bg-surface2 hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <EmployeeProfileBody employeeId={employeeId} compact />
        </div>
        <div className="border-t border-border p-3">
          <Link
            to={`/employees/${employeeId}`}
            className="block w-full rounded-edge-sm bg-surface2 px-3 py-2 text-center text-sm font-medium text-edge-teal hover:bg-surface3"
          >
            View Full Profile
          </Link>
        </div>
      </div>
    </>
  );
}
