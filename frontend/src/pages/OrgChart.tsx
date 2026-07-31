import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import "./OrgChart.css";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

export default function OrgChart() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });
  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: () => apiClient.get<Position[]>("/positions") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });
  const assignmentsQuery = useQuery({
    queryKey: ["position-assignments", "current"],
    queryFn: () => apiClient.get<PositionAssignment[]>("/position-assignments?current_only=true"),
  });

  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const unitIdsForCompany = useMemo(() => {
    if (!activeCompanyId || !unitsQuery.data) return new Set<string>();
    return new Set(unitsQuery.data.filter((u) => u.company_id === activeCompanyId).map((u) => u.id));
  }, [activeCompanyId, unitsQuery.data]);

  const tree = useMemo(() => {
    if (!positionsQuery.data) return [];
    const positions = positionsQuery.data.filter((p) => unitIdsForCompany.has(p.org_unit_id));
    const byId = new Map(positions.map((p) => [p.id, p]));
    const childrenOf = new Map<string, Position[]>();
    const roots: Position[] = [];

    for (const p of positions) {
      if (p.reports_to_position_id && byId.has(p.reports_to_position_id)) {
        const list = childrenOf.get(p.reports_to_position_id) ?? [];
        list.push(p);
        childrenOf.set(p.reports_to_position_id, list);
      } else {
        roots.push(p);
      }
    }

    function build(position: Position): TreeNode {
      return {
        position,
        children: (childrenOf.get(position.id) ?? []).map(build),
      };
    }

    return roots.map(build);
  }, [positionsQuery.data, unitIdsForCompany]);

  const employeeForPosition = useMemo(() => {
    const map = new Map<string, Employee>();
    if (!assignmentsQuery.data || !employeesQuery.data) return map;
    const employeesById = new Map(employeesQuery.data.map((e) => [e.id, e]));
    for (const a of assignmentsQuery.data) {
      const emp = employeesById.get(a.employee_id);
      if (emp) map.set(a.position_id, emp);
    }
    return map;
  }, [assignmentsQuery.data, employeesQuery.data]);

  const matchesSearch = (node: TreeNode): boolean => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const emp = employeeForPosition.get(node.position.id);
    const haystack = `${node.position.title} ${emp ? `${emp.first_name} ${emp.last_name}` : ""}`.toLowerCase();
    return haystack.includes(q) || node.children.some(matchesSearch);
  };

  const isDirectMatch = (node: TreeNode): boolean => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    const emp = employeeForPosition.get(node.position.id);
    const haystack = `${node.position.title} ${emp ? `${emp.first_name} ${emp.last_name}` : ""}`.toLowerCase();
    return haystack.includes(q);
  };

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isLoading = companiesQuery.isLoading || positionsQuery.isLoading || unitsQuery.isLoading;
  const visibleRoots = tree.filter(matchesSearch);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Org Chart</h1>
        <p className="mt-1 text-sm text-text-muted">Click a box to expand or collapse its reports.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={activeCompanyId ?? ""}
          onChange={(e) => setSelectedCompanyId(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          {(companiesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or title..."
          className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      <div className="rounded-edge-lg border border-border bg-surface p-6 overflow-x-auto">
        {isLoading && <p className="p-4 text-sm text-text-muted">Loading...</p>}
        {!isLoading && tree.length === 0 && <p className="p-4 text-sm text-text-dim">No positions in this company yet.</p>}
        {visibleRoots.length > 0 && (
          <div className="flex min-w-max justify-center gap-10">
            {visibleRoots.map((node) => (
              <OrgNode
                key={node.position.id}
                node={node}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
                employeeForPosition={employeeForPosition}
                matchesSearch={matchesSearch}
                isDirectMatch={isDirectMatch}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TIER_BOX_STYLE = [
  "border border-edge-teal/40 bg-edge-navy text-white shadow-edge-md",
  "border border-border border-t-[3px] border-t-edge-teal bg-surface shadow-edge-sm",
  "border border-border bg-surface2",
];

function OrgNode({
  node,
  depth,
  collapsed,
  onToggle,
  employeeForPosition,
  matchesSearch,
  isDirectMatch,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  employeeForPosition: Map<string, Employee>;
  matchesSearch: (node: TreeNode) => boolean;
  isDirectMatch: (node: TreeNode) => boolean;
}) {
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const tierStyle = TIER_BOX_STYLE[Math.min(depth, TIER_BOX_STYLE.length - 1)];
  const isRoot = depth === 0;

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.position.id)}
        className={`group relative flex w-44 flex-col gap-1 rounded-edge-md px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-edge-md ${tierStyle} ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        } ${isDirectMatch(node) ? "ring-2 ring-edge-teal ring-offset-1 ring-offset-surface" : ""}`}
      >
        <span className={`text-xs font-semibold leading-tight ${isRoot ? "text-white" : "text-text"}`}>
          {node.position.title}
        </span>
        {employee ? (
          <span className={`text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-text-muted"}`}>
            {employee.first_name} {employee.last_name}
          </span>
        ) : (
          <span className="inline-block w-fit rounded-edge-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
            Vacant
          </span>
        )}
        {hasChildren && (
          <span className={`mt-0.5 text-[10px] ${isRoot ? "text-white/50" : "text-text-dim"}`}>
            {isCollapsed ? "▸" : "▾"} {node.children.length} direct report{node.children.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {hasChildren && !isCollapsed && visibleChildren.length > 0 && (
        <ul className="org-tree">
          {visibleChildren.map((child) => (
            <li key={child.position.id}>
              <OrgNode
                node={child}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                employeeForPosition={employeeForPosition}
                matchesSearch={matchesSearch}
                isDirectMatch={isDirectMatch}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
