import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";

// Same 12 hues as the original full-saturation hue-wheel (still 30 degrees
// apart, starting at the brand teal's own hue -- that distinctiveness work
// was correct and is untouched), but desaturated (~34%) and pulled to a
// consistent mid lightness (~42%) -- a visual design review flagged the
// original as reading like a color wheel rather than a considered palette,
// since this dot is now the ONLY place department color appears on a card
// (the avatar and card border used to repeat the same hue at full
// saturation too; both now stay neutral, see EmployeeAvatar.tsx and
// OrgChart.tsx's tierStyle()). Recomputed via HSL, not hand-picked -- same
// rigor as the original palette, different target (calm, not maximal
// distinctiveness). Must stay the same length/order as AVATAR_PALETTE
// (EmployeeAvatar.tsx) -- both indexed by the same colorIndex.
//
// Bare hex only, deliberately no matching `bg-[#...]` class export --
// found live while verifying this same fix that one used to exist here
// (SWATCH_PALETTE, built via `SWATCH_HEX.map(hex => \`bg-[#${hex}]\`)`) and
// silently never worked: Tailwind's content scanner finds utility classes
// by matching complete, literal text in the source, and a template-literal
// interpolation is never that -- unlike AVATAR_PALETTE (EmployeeAvatar.tsx),
// whose classes are hand-written literal strings and do work. Every
// consumer below applies the hex via inline `style`, the same pattern this
// file's own filter-chip active state already used for the identical
// reason.
const SWATCH_HEX = [
  "#47907d",
  "#477d90",
  "#475990",
  "#594790",
  "#7d4790",
  "#90477d",
  "#904759",
  "#905947",
  "#907d47",
  "#7d9047",
  "#599047",
  "#479059",
];

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
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
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
