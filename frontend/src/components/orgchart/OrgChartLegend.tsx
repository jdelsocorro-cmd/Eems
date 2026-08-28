import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";

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

// Department filter, collapsed behind a popover trigger rather than an
// always-visible chip row. At 11 departments the chip row already wrapped
// to 2 lines (and will only grow), permanently taxing vertical space for a
// filter most sessions never touch. A fixed-height trigger scales to any
// department count and only costs space when actually opened. Clicking a
// chip toggles it into `activeIds` same as before; empty set means "no
// filter, show everything."
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
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  if (departments.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-edge-sm border px-2.5 py-1.5 text-xs font-medium transition ${
          activeIds.size > 0 ? "border-edge-teal/40 bg-accent-soft text-text" : "border-border bg-surface text-text-muted hover:border-border-hover hover:text-text"
        }`}
      >
        <IconFilter size={13} className={activeIds.size > 0 ? "text-edge-teal" : "text-text-dim"} />
        Filter by department
        {activeIds.size > 0 && (
          <span className="rounded-full bg-edge-teal px-1.5 py-0.5 text-[10px] font-semibold text-edge-navy">{activeIds.size}</span>
        )}
        <IconChevronDown size={13} className={`text-text-dim transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-[320px] max-h-72 overflow-y-auto rounded-edge-md border border-border-hover bg-surface p-3 shadow-edge-lg">
          <div className="flex flex-wrap gap-1.5 text-xs">
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
          </div>
          {activeIds.size > 0 && (
            <button type="button" onClick={onClear} className="mt-2 px-1 py-1 text-xs font-semibold text-edge-teal hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
