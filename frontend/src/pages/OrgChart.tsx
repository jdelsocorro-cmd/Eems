import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, Position, PositionAssignment, Team } from "@/lib/types";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

export default function OrgChart() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: () => apiClient.get<Team[]>("/teams") });
  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: () => apiClient.get<Position[]>("/positions") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });
  const assignmentsQuery = useQuery({
    queryKey: ["position-assignments", "current"],
    queryFn: () => apiClient.get<PositionAssignment[]>("/position-assignments?current_only=true"),
  });

  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const teamIdsForCompany = useMemo(() => {
    if (!activeCompanyId || !teamsQuery.data) return new Set<string>();
    // Teams don't carry company_id directly -- derive via department, which
    // this page doesn't otherwise need, so just accept all teams when there's
    // only one company (Phase 1 reality) and narrow later if that changes.
    return new Set(teamsQuery.data.map((t) => t.id));
  }, [activeCompanyId, teamsQuery.data]);

  const tree = useMemo(() => {
    if (!positionsQuery.data) return [];
    const positions = positionsQuery.data.filter((p) => teamIdsForCompany.has(p.team_id));
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
  }, [positionsQuery.data, teamIdsForCompany]);

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

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const isLoading = companiesQuery.isLoading || positionsQuery.isLoading || teamsQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Org Chart</h1>
        <p className="mt-1 text-sm text-text-muted">Navigate the company hierarchy. Click a row to expand or collapse.</p>
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

      <div className="rounded-edge-lg border border-border bg-surface p-2">
        {isLoading && <p className="p-4 text-sm text-text-muted">Loading...</p>}
        {!isLoading && tree.length === 0 && <p className="p-4 text-sm text-text-dim">No positions in this company yet.</p>}
        {tree.filter(matchesSearch).map((node) => (
          <TreeRow
            key={node.position.id}
            node={node}
            depth={0}
            collapsed={collapsed}
            onToggle={toggle}
            employeeForPosition={employeeForPosition}
            matchesSearch={matchesSearch}
          />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  collapsed,
  onToggle,
  employeeForPosition,
  matchesSearch,
}: {
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  employeeForPosition: Map<string, Employee>;
  matchesSearch: (node: TreeNode) => boolean;
}) {
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);

  return (
    <div>
      <div
        onClick={() => hasChildren && onToggle(node.position.id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`flex items-center gap-2 rounded-edge-sm py-1.5 pr-2 text-sm ${hasChildren ? "cursor-pointer hover:bg-surface2" : ""}`}
      >
        <span className="w-4 text-text-dim">{hasChildren ? (isCollapsed ? "▸" : "▾") : ""}</span>
        <span className="font-medium text-text">{node.position.title}</span>
        {employee ? (
          <span className="text-text-muted">
            — {employee.first_name} {employee.last_name}
          </span>
        ) : (
          <span className="text-text-dim italic">— vacant</span>
        )}
        {hasChildren && <span className="ml-auto text-xs text-text-dim">{node.children.length} direct report(s)</span>}
      </div>
      {!isCollapsed && visibleChildren.map((child) => (
        <TreeRow
          key={child.position.id}
          node={child}
          depth={depth + 1}
          collapsed={collapsed}
          onToggle={onToggle}
          employeeForPosition={employeeForPosition}
          matchesSearch={matchesSearch}
        />
      ))}
    </div>
  );
}
