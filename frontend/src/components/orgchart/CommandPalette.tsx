import { useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconUser } from "@tabler/icons-react";

import type { Employee, Position } from "@/lib/types";
import { EmployeeAvatar } from "@/components/orgchart/EmployeeAvatar";

const MAX_RESULTS = 8;

// A second, faster way to reach someone -- distinct from the page's own
// "Search by name or title..." input, which dims non-matching nodes in
// place for in-view scanning. This instead searches every position in the
// company regardless of the current Show/department/search filters (a
// person can be found here even if they're currently dimmed or scrolled out
// of view) and jumps straight to Focus Mode. Same backdrop/z-50 convention
// as EmployeeSidePanel.tsx, the app's other overlay precedent.
export function CommandPalette({
  isOpen,
  onClose,
  positions,
  employeeForPosition,
  departmentNameForPosition,
  colorIndexForPosition,
  onFocusPosition,
}: {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  employeeForPosition: Map<string, Employee>;
  departmentNameForPosition: (position: Position) => string;
  colorIndexForPosition: (position: Position) => number;
  onFocusPosition: (positionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
    // Deferred one tick -- the input isn't in the DOM yet on the same
    // render pass where isOpen flips true, so an immediate focus() would
    // silently no-op.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = positions.filter((position) => {
      const emp = employeeForPosition.get(position.id);
      const haystack = `${position.title} ${emp ? `${emp.first_name} ${emp.last_name}` : ""}`.toLowerCase();
      return !q || haystack.includes(q);
    });
    matches.sort((a, b) => {
      const empA = employeeForPosition.get(a.id);
      const empB = employeeForPosition.get(b.id);
      const labelA = empA ? `${empA.first_name} ${empA.last_name}` : a.title;
      const labelB = empB ? `${empB.first_name} ${empB.last_name}` : b.title;
      return labelA.localeCompare(labelB);
    });
    return matches.slice(0, MAX_RESULTS);
  }, [positions, employeeForPosition, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  function select(positionId: string) {
    onFocusPosition(positionId);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} />
      <div className="fixed inset-x-0 top-[15vh] z-50 mx-auto w-full max-w-[480px] px-4">
        <div className="overflow-hidden rounded-edge-lg border border-border-hover bg-surface shadow-edge-lg">
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <IconSearch size={14} className="shrink-0 text-text-dim" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const active = results[activeIndex];
                  if (active) select(active.id);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="Search by name or title..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-dim"
            />
          </div>

          <div className="max-h-80 overflow-y-auto p-1.5">
            {results.length === 0 && <div className="px-3 py-6 text-center text-xs text-text-dim">No matches.</div>}
            {results.map((position, index) => {
              const emp = employeeForPosition.get(position.id);
              const colorIndex = colorIndexForPosition(position);
              return (
                <button
                  key={position.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(position.id)}
                  className={`flex w-full items-center gap-2.5 rounded-edge-sm px-2.5 py-2 text-left ${index === activeIndex ? "bg-surface3" : ""}`}
                >
                  {emp ? (
                    <EmployeeAvatar firstName={emp.first_name} lastName={emp.last_name} colorIndex={colorIndex} size="sm" />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-text-dim text-text-dim">
                      <IconUser size={12} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-text">
                      {emp ? `${emp.first_name} ${emp.last_name}` : <span className="italic text-text-dim">Open position</span>}
                    </div>
                    <div className="truncate text-[10.5px] text-text-dim">
                      {position.title} · {departmentNameForPosition(position)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-3.5 border-t border-border px-4 py-2 text-[10px] text-text-dim">
            <span>
              <span className="rounded bg-surface3 px-1.5 py-0.5 font-semibold text-text-muted">↑↓</span> navigate
            </span>
            <span>
              <span className="rounded bg-surface3 px-1.5 py-0.5 font-semibold text-text-muted">↵</span> focus
            </span>
            <span>
              <span className="rounded bg-surface3 px-1.5 py-0.5 font-semibold text-text-muted">esc</span> close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
