import { IconUser } from "@tabler/icons-react";

import { legendSwatchHex } from "@/components/orgchart/OrgChartLegend";

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

// Same three-tier semantics as fillRateBadgeClass, expressed as a stroke
// color instead of a Tailwind class -- inline style is the only way to give
// an SVG stroke "whichever of the three states this department is in,"
// same reasoning OrgChartLegend's chips use inline style for a department's
// own hex (Tailwind can't express a per-item dynamic color as a static
// class).
function fillRateRingColor(fillRate: number): string {
  if (fillRate >= 1) return "var(--c-green)";
  if (fillRate <= 0) return "var(--c-yellow)";
  return "var(--c-text-muted)";
}

// One ring replaces the old linear bar + separate percentage pill -- the
// percentage lives inside the ring itself, so there's only one fill-rate
// representation instead of two saying the same thing two different ways.
// Exported (with a size knob) so List view's swimlane header can reuse the
// exact same "how healthy is this department" encoding instead of a second,
// competing visual language (a flat percentage pill) for the same fact.
export function FillRateRing({ fillRate, size = 32 }: { fillRate: number; size?: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fillRate)) * 100);
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  const fontSize = size >= 32 ? 9 : 7.5;
  // At 0% the "filled" arc has zero length and never paints, so the
  // background track is the ONLY stroke that ever renders -- leaving it
  // neutral gray meant a fully-vacant department's ring never actually
  // showed the warning color the three-tier system promises, silently
  // failing the exact case (0% staffed) most worth flagging. Coloring the
  // track itself amber specifically at 0% is what makes the warning state
  // actually visible.
  const trackColor = pct === 0 ? fillRateRingColor(fillRate) : undefined;

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0 -rotate-90">
      <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="3" stroke={trackColor} className={trackColor ? undefined : "stroke-surface3"} />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        stroke={fillRateRingColor(fillRate)}
        strokeDasharray={`${dash} ${circumference}`}
      />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-text font-semibold tabular-nums"
        style={{ fontSize: `${fontSize}px`, transform: "rotate(90deg)", transformOrigin: "16px 16px" }}
      >
        {pct}%
      </text>
    </svg>
  );
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
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: legendSwatchHex(dept.colorIndex) }} />

          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">{dept.name}</span>
            <FillRateRing fillRate={dept.fillRate} />
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold leading-none text-text">{dept.headcount}</span>
            <span className="text-[11px] text-text-dim">of {dept.totalPositions} filled</span>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-text-dim">
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
          </div>
        </button>
      ))}
    </div>
  );
}
