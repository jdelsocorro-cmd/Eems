import { useState } from "react";

import type { OrgUnit, Position } from "@/lib/types";

// Search + department-grouped <select> over a list of positions. Shared
// between UserManagement.tsx (assigning/reassigning an employee's own
// position) and ReassignManagerPanel.tsx (choosing a position's new
// manager) -- same picking UI either way, just a different meaning for
// what "assign" does once a position is chosen.
export function PositionPicker({
  positions,
  units,
  onAssign,
}: {
  positions: Position[];
  units: OrgUnit[];
  onAssign: (positionId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const unitsById = new Map(units.map((u) => [u.id, u]));

  const q = search.trim().toLowerCase();
  const filtered = q
    ? positions.filter((p) => `${p.title} ${unitsById.get(p.org_unit_id)?.name ?? ""}`.toLowerCase().includes(q))
    : positions;

  const grouped = new Map<string, Position[]>();
  for (const p of filtered) {
    const groupLabel = unitsById.get(p.org_unit_id)?.name ?? "Ungrouped";
    const list = grouped.get(groupLabel) ?? [];
    list.push(p);
    grouped.set(groupLabel, list);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter positions..."
        className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onAssign(e.target.value);
        }}
        className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="" disabled>
          Choose a position...
        </option>
        {[...grouped.entries()].map(([groupLabel, groupPositions]) => (
          <optgroup key={groupLabel} label={groupLabel}>
            {groupPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
