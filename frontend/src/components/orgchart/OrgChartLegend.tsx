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
// Raw hex values are kept alongside the Tailwind classes (not just inside
// them) because the interactive chips below need the bare hex for inline
// border/background styling -- Tailwind can't express "this department's
// own color, whichever one that is" as a static class.
const SWATCH_HEX = [
  "#2fc6a0",
  "#2fa0c6",
  "#2f54c6",
  "#542fc6",
  "#a02fc6",
  "#c62fa0",
  "#c62f54",
  "#c6542f",
  "#c6a02f",
  "#a0c62f",
  "#54c62f",
  "#2fc654",
];

const SWATCH_PALETTE = SWATCH_HEX.map((hex) => `bg-[#${hex.slice(1)}]`);

export function legendSwatchClass(colorIndex: number): string {
  return SWATCH_PALETTE[colorIndex % SWATCH_PALETTE.length];
}

export function legendSwatchHex(colorIndex: number): string {
  return SWATCH_HEX[colorIndex % SWATCH_HEX.length];
}

// Department filter chips -- clicking a chip toggles it into `activeIds`.
// Empty set means "no filter, show everything" (matching the reference
// mockup's behavior), not "show nothing." Active-chip styling is keyed off
// each department's own hex via inline style, since Tailwind can't express
// a per-department dynamic color as a static class.
export function OrgChartLegend({
  departments,
  activeIds,
  onToggle,
  onClear,
}: {
  departments: { id: string; name: string; colorIndex: number }[];
  activeIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  if (departments.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 font-medium uppercase tracking-wide text-text-dim">Filter by department:</span>
      {departments.map((d) => {
        const hex = legendSwatchHex(d.colorIndex);
        const isActive = activeIds.has(d.id);
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onToggle(d.id)}
            style={isActive ? { borderColor: hex, backgroundColor: `${hex}24` } : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium transition ${
              isActive ? "text-text" : "border-border bg-surface text-text-muted hover:border-border-hover hover:text-text"
            }`}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${legendSwatchClass(d.colorIndex)}`} />
            {d.name}
          </button>
        );
      })}
      {activeIds.size > 0 && (
        <button type="button" onClick={onClear} className="px-1 py-1 font-semibold text-edge-teal hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}
