import { IconArrowRight, IconUser } from "@tabler/icons-react";

import { legendSwatchClass } from "@/components/orgchart/OrgChartLegend";

export interface DepartmentStat {
  id: string;
  name: string;
  colorIndex: number;
  headcount: number;
  totalPositions: number;
  fillRate: number;
  headTitle: string | null;
  headEmployeeName: string | null;
  extraLeads: number;
}

// Only the two extremes get a strong semantic color -- fully staffed
// (success) or fully vacant (warning) are the two states worth flagging at
// a glance; every in-between percentage stays neutral rather than smearing
// a red-to-green gradient across values that don't warrant that much alarm.
export function fillRateBadgeClass(fillRate: number): string {
  if (fillRate >= 1) return "bg-success-soft text-success";
  if (fillRate <= 0) return "bg-warning-soft text-warning";
  return "bg-surface3 text-text-muted";
}

// The "Departments" view -- a fixed company-wide snapshot (not filtered by
// Show/search, see OrgChart.tsx's departmentStats comment), one card per
// org_unit. Purely presentational: every number here is computed once by
// the caller from data it already fetches.
export function DepartmentGrid({
  departments,
  onSelect,
}: {
  departments: DepartmentStat[];
  onSelect: (departmentId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {departments.map((dept) => (
        <button
          key={dept.id}
          type="button"
          onClick={() => onSelect(dept.id)}
          className="group relative overflow-hidden rounded-edge-md bg-surface p-3.5 text-left shadow-edge-sm transition hover:-translate-y-0.5 hover:shadow-edge-md"
        >
          <div className={`absolute inset-x-0 top-0 h-[3px] ${legendSwatchClass(dept.colorIndex)}`} />

          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">{dept.name}</span>
            <IconArrowRight size={13} className="shrink-0 text-text-dim transition group-hover:translate-x-0.5 group-hover:text-edge-teal" />
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold leading-none text-text">{dept.headcount}</span>
            <span className="text-[11px] text-text-dim">of {dept.totalPositions} filled</span>
          </div>

          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface3">
            <div
              className={`h-full rounded-full ${legendSwatchClass(dept.colorIndex)}`}
              style={{ width: `${Math.round(dept.fillRate * 100)}%` }}
            />
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-dim">
              {dept.headEmployeeName ? (
                <span className="truncate">{dept.headEmployeeName}</span>
              ) : dept.headTitle ? (
                <span className="flex items-center gap-1 truncate italic">
                  <IconUser size={11} /> Vacant lead
                </span>
              ) : (
                <span className="truncate">No positions yet</span>
              )}
              {dept.extraLeads > 0 && <span className="shrink-0">+{dept.extraLeads} more</span>}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fillRateBadgeClass(dept.fillRate)}`}>
              {Math.round(dept.fillRate * 100)}%
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
