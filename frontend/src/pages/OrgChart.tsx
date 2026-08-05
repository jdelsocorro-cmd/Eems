import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import { Button, Card, EmptyState, LoadingState, Toolbar, ToolbarDivider } from "@/components/ui";
import { usePermissions } from "@/hooks/usePermissions";
import "./OrgChart.css";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

// The employee name here sits inside another element that's already
// clickable (OrgNode's toggle button, TreeListRow's toggle row), so this
// can't be a plain <Link>/<a> -- nesting interactive content invalidates
// the outer control (a <button> especially). navigate() + stopPropagation
// gets the same "click the name to open Employee 360" behavior without
// that. Falls back to plain text for callers without employee.view_360,
// same as the shared EmployeeLink used everywhere else.
function EmployeeNameLink({ employeeId, children, className = "" }: { employeeId: string; children: ReactNode; className?: string }) {
  const navigate = useNavigate();
  const { has } = usePermissions();

  if (!has("employee", "view_360")) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span
      className={`cursor-pointer hover:underline ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/employees/${employeeId}`);
      }}
    >
      {children}
    </span>
  );
}

type ViewMode = "chart" | "list";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

// Reuses the app's existing semantic color tokens rather than inventing a
// new palette -- cycled per top-level branch so a whole department's
// subtree reads as one color even after scrolling away from the root.
const BRANCH_BORDER_CLASSES = ["border-l-edge-teal", "border-l-info", "border-l-success", "border-l-warning", "border-l-danger"];

export default function OrgChart() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isExporting, setIsExporting] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const autoCollapsedForCompanyRef = useRef<string | null>(null);

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

  function collectIdsAtDepth(minDepth: number): Set<string> {
    const ids = new Set<string>();
    function walk(node: TreeNode, depth: number) {
      if (depth >= minDepth && node.children.length > 0) ids.add(node.position.id);
      node.children.forEach((child) => walk(child, depth + 1));
    }
    tree.forEach((root) => walk(root, 0));
    return ids;
  }

  // First view of a company shows just the top and its direct reports --
  // full depth all at once is what made a 30+ position chart unreadable.
  // Re-collapsing only happens when the selected company actually changes,
  // never on a background refetch, so it doesn't fight the user's own
  // expand/collapse clicks.
  useEffect(() => {
    if (tree.length > 0 && autoCollapsedForCompanyRef.current !== activeCompanyId) {
      autoCollapsedForCompanyRef.current = activeCompanyId;
      setCollapsed(collectIdsAtDepth(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, activeCompanyId]);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setNaturalSize({ width: contentRef.current.scrollWidth, height: contentRef.current.scrollHeight });
    }
  }, [tree, collapsed, search, viewMode]);

  function expandAll() {
    setCollapsed(new Set());
  }

  function collapseAll() {
    setCollapsed(collectIdsAtDepth(0));
  }

  function zoomBy(delta: number) {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  }

  function fitToScreen() {
    if (!viewportRef.current || naturalSize.width === 0) return;
    const available = viewportRef.current.clientWidth - 48;
    const ratio = available / naturalSize.width;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(ratio * 100) / 100)));
  }

  async function exportPng() {
    if (!contentRef.current) return;
    setIsExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(contentRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      });
      const companyName = (companiesQuery.data ?? []).find((c) => c.id === activeCompanyId)?.name ?? "org-chart";
      const link = document.createElement("a");
      link.download = `${companyName.replace(/\s+/g, "-").toLowerCase()}-org-chart.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setIsExporting(false);
    }
  }

  const isLoading = companiesQuery.isLoading || positionsQuery.isLoading || unitsQuery.isLoading;
  const visibleRoots = tree.filter(matchesSearch);

  const chartNodes = visibleRoots.map((node, i) => (
    <OrgNode
      key={node.position.id}
      node={node}
      depth={0}
      branchIndex={i}
      collapsed={collapsed}
      onToggle={toggle}
      employeeForPosition={employeeForPosition}
      matchesSearch={matchesSearch}
      isDirectMatch={isDirectMatch}
    />
  ));

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
        <Toolbar>
          <Button variant="toolbar" size="sm" active={viewMode === "chart"} onClick={() => setViewMode("chart")}>
            Chart
          </Button>
          <Button variant="toolbar" size="sm" active={viewMode === "list"} onClick={() => setViewMode("list")}>
            List
          </Button>
        </Toolbar>
      </div>

      {viewMode === "chart" && (
        <Toolbar>
          <Button variant="toolbar" size="sm" onClick={expandAll}>
            Expand all
          </Button>
          <Button variant="toolbar" size="sm" onClick={collapseAll}>
            Collapse all
          </Button>
          <ToolbarDivider />
          <Button variant="toolbar" size="sm" onClick={() => zoomBy(-ZOOM_STEP)}>
            Zoom out
          </Button>
          <span className="w-10 text-center text-text-dim">{Math.round(zoom * 100)}%</span>
          <Button variant="toolbar" size="sm" onClick={() => zoomBy(ZOOM_STEP)}>
            Zoom in
          </Button>
          <Button variant="toolbar" size="sm" onClick={fitToScreen}>
            Fit to screen
          </Button>
          <Button variant="toolbar" size="sm" onClick={() => setZoom(1)}>
            Reset
          </Button>
          <ToolbarDivider />
          <Button variant="toolbar" size="sm" onClick={exportPng} disabled={isExporting || visibleRoots.length === 0}>
            {isExporting ? "Exporting..." : "Export as PNG"}
          </Button>
        </Toolbar>
      )}

      <Card ref={viewportRef} className="p-6" style={{ maxHeight: "75vh", overflow: "auto" }}>
        {isLoading && <LoadingState label="Loading org chart..." />}
        {!isLoading && tree.length === 0 && <EmptyState message="No positions in this company yet." />}

        {viewMode === "list" && visibleRoots.length > 0 && (
          <div>
            {visibleRoots.map((node) => (
              <TreeListRow
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

        {viewMode === "chart" &&
          visibleRoots.length > 0 &&
          (naturalSize.width > 0 ? (
            <div style={{ width: naturalSize.width * zoom, height: naturalSize.height * zoom }}>
              <div ref={contentRef} style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: "max-content" }} className="flex gap-10">
                {chartNodes}
              </div>
            </div>
          ) : (
            <div ref={contentRef} className="flex w-max justify-center gap-10">
              {chartNodes}
            </div>
          ))}
      </Card>
    </div>
  );
}

const TIER_ROOT_STYLE = "bg-edge-navy text-white shadow-edge-md";

function tierStyle(depth: number, branchClass: string): string {
  if (depth === 0) return TIER_ROOT_STYLE;
  if (depth === 1) return `${branchClass} border-l-4 bg-surface shadow-edge-md`;
  return `${branchClass} border-l-4 bg-surface2 shadow-edge-sm`;
}

function OrgNode({
  node,
  depth,
  branchIndex,
  collapsed,
  onToggle,
  employeeForPosition,
  matchesSearch,
  isDirectMatch,
}: {
  node: TreeNode;
  depth: number;
  branchIndex: number;
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
  const branchClass = BRANCH_BORDER_CLASSES[branchIndex % BRANCH_BORDER_CLASSES.length];
  const isRoot = depth === 0;

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.position.id)}
        className={`group relative flex w-44 flex-col gap-1 rounded-edge-md px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-edge-md ${tierStyle(depth, branchClass)} ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        } ${isDirectMatch(node) ? "ring-2 ring-edge-teal ring-offset-1 ring-offset-surface" : ""}`}
      >
        <span className={`text-xs font-semibold leading-tight ${isRoot ? "text-white" : "text-text"}`}>
          {node.position.title}
        </span>
        {employee ? (
          <EmployeeNameLink employeeId={employee.id} className={`text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-text-muted"}`}>
            {employee.first_name} {employee.last_name}
          </EmployeeNameLink>
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
          {visibleChildren.map((child, childIndex) => (
            <li key={child.position.id}>
              <OrgNode
                node={child}
                depth={depth + 1}
                // A branch's color is assigned once, at the CEO's direct
                // reports (depth 0 -> 1), then inherited unchanged all the
                // way down that subtree. Most companies have a single root
                // (the CEO), so coloring by root index alone (as attempted
                // originally) gave every top-level department the same
                // color -- confirmed live, every box came back
                // border-l-edge-teal. Re-assigning at the first
                // parent-to-child step instead of at the root fixes that.
                branchIndex={depth === 0 ? childIndex : branchIndex}
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

function TreeListRow({
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

  return (
    <div>
      <div
        onClick={() => hasChildren && onToggle(node.position.id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`flex items-center gap-2 rounded-edge-sm py-1.5 pr-2 text-sm ${hasChildren ? "cursor-pointer hover:bg-surface2" : ""} ${
          isDirectMatch(node) ? "bg-nav-active" : ""
        }`}
      >
        <span className="w-4 text-text-dim">{hasChildren ? (isCollapsed ? "▸" : "▾") : ""}</span>
        <span className="font-medium text-text">{node.position.title}</span>
        {employee ? (
          <EmployeeNameLink employeeId={employee.id} className="text-text-muted">
            — {employee.first_name} {employee.last_name}
          </EmployeeNameLink>
        ) : (
          <span className="rounded-edge-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">Vacant</span>
        )}
        {hasChildren && <span className="ml-auto text-xs text-text-dim">{node.children.length} direct report(s)</span>}
      </div>
      {!isCollapsed &&
        visibleChildren.map((child) => (
          <TreeListRow
            key={child.position.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            employeeForPosition={employeeForPosition}
            matchesSearch={matchesSearch}
            isDirectMatch={isDirectMatch}
          />
        ))}
    </div>
  );
}
