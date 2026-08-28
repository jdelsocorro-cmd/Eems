import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";

// Was redefined identically (down to the aria-sort wiring) in
// UserManagement.tsx and PerformanceReviewCenter.tsx -- one shared,
// generic-over-column-type definition instead of two copies that could
// silently diverge. Generic so each page keeps its own concrete
// SortColumn union without this component needing to know it.
export function SortHeader<T extends string>({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  align = "left",
}: {
  label: string;
  column: T;
  sortColumn: T;
  sortDirection: "asc" | "desc";
  onSort: (column: T) => void;
  // A numeric column's <Td> is typically right-aligned (so digits line up),
  // which left this header's own text stranded at the opposite edge of the
  // same column -- header and data disagreeing about where the column
  // "starts" reads as misaligned, not just informal. Optional and
  // left-default so the two other pages already using this component are
  // unaffected.
  align?: "left" | "right";
}) {
  const isActive = sortColumn === column;
  return (
    <th className={`px-4 py-2 ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-sort={isActive ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-text ${isActive ? "text-text" : "text-text-muted"}`}
      >
        {label}
        {isActive && (sortDirection === "asc" ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
      </button>
    </th>
  );
}
