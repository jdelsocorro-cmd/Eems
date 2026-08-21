// Solid-color swatch version of the same palette EmployeeAvatar uses
// (soft/tinted there since it sits behind initials text; solid here since
// it's a small standalone dot). Keeping both derived from one colorIndex
// keeps a department's color consistent between the legend, the avatars,
// and the node accent border everywhere on the page.
// Must stay the same length and order as AVATAR_PALETTE (EmployeeAvatar.tsx)
// and DEPARTMENT_BORDER_CLASSES (OrgChart.tsx) -- all three are indexed by
// the same colorIndex, so a mismatched length would make a department's
// legend swatch, avatar, and card border disagree past index 4.
const SWATCH_PALETTE = [
  "bg-edge-teal",
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-danger",
  "bg-purple-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-cyan-500",
  "bg-lime-500",
  "bg-orange-500",
  "bg-violet-500",
];

export function legendSwatchClass(colorIndex: number): string {
  return SWATCH_PALETTE[colorIndex % SWATCH_PALETTE.length];
}

export function OrgChartLegend({ departments }: { departments: { id: string; name: string; colorIndex: number }[] }) {
  if (departments.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted">
      <span className="font-medium uppercase tracking-wide text-text-dim">Legend:</span>
      {departments.map((d) => (
        <span key={d.id} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${legendSwatchClass(d.colorIndex)}`} />
          {d.name}
        </span>
      ))}
    </div>
  );
}
