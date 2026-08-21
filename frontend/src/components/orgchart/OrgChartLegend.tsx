// Solid-color swatch version of the same palette EmployeeAvatar uses
// (soft/tinted there since it sits behind initials text; solid here since
// it's a small standalone dot). Keeping both derived from one colorIndex
// keeps a department's color consistent between the legend, the avatars,
// and the node accent border everywhere on the page.
// Solid version of the same 12 hue-wheel colors AVATAR_PALETTE uses (see
// its comment for why -- hand-picked Tailwind shades weren't actually
// checked for pairwise hue distinctiveness and three pairs turned out to be
// the same color family). Must stay the same length/order as
// AVATAR_PALETTE (EmployeeAvatar.tsx) and DEPARTMENT_BORDER_CLASSES
// (OrgChart.tsx) -- all three are indexed by the same colorIndex.
const SWATCH_PALETTE = [
  "bg-[#2fc6a0]",
  "bg-[#2fa0c6]",
  "bg-[#2f54c6]",
  "bg-[#542fc6]",
  "bg-[#a02fc6]",
  "bg-[#c62fa0]",
  "bg-[#c62f54]",
  "bg-[#c6542f]",
  "bg-[#c6a02f]",
  "bg-[#a0c62f]",
  "bg-[#54c62f]",
  "bg-[#2fc654]",
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
