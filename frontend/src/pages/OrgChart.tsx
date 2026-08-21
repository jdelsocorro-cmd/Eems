import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import { Button, Card, EmptyState, LoadingState, Toolbar, ToolbarDivider } from "@/components/ui";
import { usePermissions } from "@/hooks/usePermissions";
import { EmployeeAvatar } from "@/components/orgchart/EmployeeAvatar";
import { OrgChartLegend, legendSwatchClass } from "@/components/orgchart/OrgChartLegend";
import { OrgChartMinimap, type MinimapNode } from "@/components/orgchart/OrgChartMinimap";
import { EmployeeSidePanel } from "@/components/orgchart/EmployeeSidePanel";
import "./OrgChart.css";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

type ViewMode = "chart" | "list";
type ShowFilter = "all" | "active" | "vacant";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;

// Same 5-color order EmployeeAvatar.tsx and OrgChartLegend.tsx use, so a
// department's color matches everywhere it appears (node border, avatar,
// legend swatch, minimap block) -- indexed by org_unit_id, not by branch
// position in the tree. The old branch-index approach (still visible in
// legendSwatchClass/avatarColorClass's own comments) had a real bug-
// adjacent quirk: the same department could read as a different color
// after a re-render if sibling ordering shifted. Keying on the actual
// org_unit_id fixes that and is what makes the legend meaningful at all.
const DEPARTMENT_BORDER_CLASSES = ["border-l-edge-teal", "border-l-info", "border-l-success", "border-l-warning", "border-l-danger"];

export default function OrgChart() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const { has } = usePermissions();
  const canViewProfiles = has("employee", "view_360");

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

  const unitsForCompany = useMemo(() => {
    if (!activeCompanyId || !unitsQuery.data) return [];
    return unitsQuery.data.filter((u) => u.company_id === activeCompanyId).sort((a, b) => a.name.localeCompare(b.name));
  }, [activeCompanyId, unitsQuery.data]);

  const unitIdsForCompany = useMemo(() => new Set(unitsForCompany.map((u) => u.id)), [unitsForCompany]);

  // Stable per-department color index, built once per company selection --
  // every card border, avatar, legend swatch, and minimap block for a given
  // department reads this same map, so the color always means the same
  // thing everywhere on the page.
  const orgUnitColorIndex = useMemo(() => new Map(unitsForCompany.map((u, i) => [u.id, i])), [unitsForCompany]);

  function colorIndexForPosition(position: Position): number {
    return orgUnitColorIndex.get(position.org_unit_id) ?? 0;
  }

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

  // Company-wide stats -- computed over the FULL tree regardless of what's
  // currently expanded/collapsed/searched, since these describe the
  // company's structure, not the current view.
  const stats = useMemo(() => {
    const allNodes: TreeNode[] = [];
    function walk(n: TreeNode) {
      allNodes.push(n);
      n.children.forEach(walk);
    }
    tree.forEach(walk);

    const managerNodes = allNodes.filter((n) => n.children.length > 0);
    const employeeIds = new Set(allNodes.map((n) => employeeForPosition.get(n.position.id)?.id).filter((id): id is string => !!id));
    const spanOfControl = managerNodes.length > 0 ? managerNodes.reduce((sum, n) => sum + n.children.length, 0) / managerNodes.length : 0;

    const positionIdsInScope = new Set(allNodes.map((n) => n.position.id));
    const startDates = (assignmentsQuery.data ?? [])
      .filter((a) => positionIdsInScope.has(a.position_id))
      .map((a) => a.start_date);
    // ISO YYYY-MM-DD strings sort correctly with plain string comparison.
    const lastUpdated = startDates.length > 0 ? startDates.reduce((max, d) => (d > max ? d : max)) : null;

    return {
      totalEmployees: employeeIds.size,
      departments: unitsForCompany.length,
      managers: managerNodes.length,
      teams: managerNodes.length,
      spanOfControl,
      lastUpdated,
    };
  }, [tree, employeeForPosition, unitsForCompany, assignmentsQuery.data]);

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

  // "Show" dims rather than removes non-matching nodes -- removing a node
  // from the middle of the tree would mean deciding what happens to its
  // descendants (same problem search's recursive matching already solves
  // for a different axis), and dimming gets the real value ("where are the
  // vacancies") without a second tree-collapsing code path to keep in sync
  // with the first.
  const passesShowFilter = (node: TreeNode): boolean => {
    if (showFilter === "all") return true;
    const emp = employeeForPosition.get(node.position.id);
    if (showFilter === "vacant") return !emp;
    return !!emp && emp.status === "active";
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

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

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

  function toggleFullscreen() {
    if (!viewportRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewportRef.current.requestFullscreen().catch(() => {
        // Fullscreen API unavailable/blocked -- graceful no-op, the toolbar
        // button just won't visibly do anything rather than erroring.
      });
    }
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

  function buildMinimapTree(nodes: TreeNode[]): MinimapNode[] {
    return nodes.map((n) => ({
      position: n.position,
      colorIndex: colorIndexForPosition(n.position),
      children: buildMinimapTree(n.children),
    }));
  }
  const minimapTree = useMemo(() => buildMinimapTree(tree), [tree, orgUnitColorIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartNodes = visibleRoots.map((node) => (
    <OrgNode
      key={node.position.id}
      node={node}
      depth={0}
      collapsed={collapsed}
      onToggle={toggle}
      employeeForPosition={employeeForPosition}
      matchesSearch={matchesSearch}
      isDirectMatch={isDirectMatch}
      passesShowFilter={passesShowFilter}
      colorIndexForPosition={colorIndexForPosition}
      canViewProfiles={canViewProfiles}
      onSelectEmployee={setSelectedEmployeeId}
    />
  ));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Org Chart</h1>
        <p className="mt-1 text-sm text-text-muted">Click a box to expand or collapse its reports. Click a name to preview their profile.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-text-muted">
          Company
          <select
            value={activeCompanyId ?? ""}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm font-normal normal-case text-text"
          >
            {(companiesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-text-muted">
          Show
          <select
            value={showFilter}
            onChange={(e) => setShowFilter(e.target.value as ShowFilter)}
            className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm font-normal normal-case text-text"
          >
            <option value="all">All Employees</option>
            <option value="active">Active Only</option>
            <option value="vacant">Vacant Positions</option>
          </select>
        </label>

        <div className="flex flex-1 flex-col gap-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or title..."
            className="min-w-[200px] flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>

        <Toolbar>
          <Button variant="toolbar" size="sm" active={viewMode === "chart"} onClick={() => setViewMode("chart")}>
            Chart
          </Button>
          <Button variant="toolbar" size="sm" active={viewMode === "list"} onClick={() => setViewMode("list")}>
            List
          </Button>
        </Toolbar>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatStrip stats={stats} />
      </div>

      {viewMode === "chart" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <OrgChartLegend departments={unitsForCompany.map((u) => ({ id: u.id, name: u.name, colorIndex: orgUnitColorIndex.get(u.id) ?? 0 }))} />
          <Toolbar>
            <Button variant="toolbar" size="sm" onClick={expandAll}>
              Expand all
            </Button>
            <Button variant="toolbar" size="sm" onClick={collapseAll}>
              Collapse all
            </Button>
            <ToolbarDivider />
            <Button variant="toolbar" size="sm" onClick={() => zoomBy(-ZOOM_STEP)}>
              −
            </Button>
            <span className="w-10 text-center text-text-dim">{Math.round(zoom * 100)}%</span>
            <Button variant="toolbar" size="sm" onClick={() => zoomBy(ZOOM_STEP)}>
              +
            </Button>
            <Button variant="toolbar" size="sm" onClick={fitToScreen}>
              Fit to screen
            </Button>
            <Button variant="toolbar" size="sm" onClick={toggleFullscreen}>
              {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            </Button>
            <ToolbarDivider />
            <Button variant="toolbar" size="sm" onClick={exportPng} disabled={isExporting || visibleRoots.length === 0}>
              {isExporting ? "Exporting..." : "Export as PNG"}
            </Button>
          </Toolbar>
        </div>
      )}

      <div className="relative">
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
                  passesShowFilter={passesShowFilter}
                  colorIndexForPosition={colorIndexForPosition}
                  canViewProfiles={canViewProfiles}
                  onSelectEmployee={setSelectedEmployeeId}
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

        {viewMode === "chart" && tree.length > 0 && (
          <div className="absolute bottom-4 right-4">
            <OrgChartMinimap tree={minimapTree} viewportRef={viewportRef} contentSize={naturalSize} zoom={zoom} />
          </div>
        )}
      </div>

      {selectedEmployeeId && <EmployeeSidePanel employeeId={selectedEmployeeId} onClose={() => setSelectedEmployeeId(null)} />}
    </div>
  );
}

function StatStrip({
  stats,
}: {
  stats: { totalEmployees: number; departments: number; managers: number; teams: number; spanOfControl: number; lastUpdated: string | null };
}) {
  const tiles: { label: string; value: string }[] = [
    { label: "Total Employees", value: String(stats.totalEmployees) },
    { label: "Departments", value: String(stats.departments) },
    { label: "Managers", value: String(stats.managers) },
    { label: "Teams", value: String(stats.teams) },
    { label: "Span of Control", value: stats.spanOfControl > 0 ? stats.spanOfControl.toFixed(1) + " avg" : "—" },
    { label: "Last Position Change", value: stats.lastUpdated ?? "—" },
  ];

  return (
    <Card className="flex flex-1 flex-wrap gap-x-6 gap-y-2 p-3">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-[110px]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{t.label}</p>
          <p className="mt-0.5 text-lg font-semibold text-text">{t.value}</p>
        </div>
      ))}
    </Card>
  );
}

const TIER_ROOT_STYLE = "bg-edge-navy text-white shadow-edge-md";

function tierStyle(depth: number, borderClass: string): string {
  if (depth === 0) return TIER_ROOT_STYLE;
  if (depth === 1) return `${borderClass} border-l-4 bg-surface shadow-edge-md`;
  return `${borderClass} border-l-4 bg-surface2 shadow-edge-sm`;
}

interface NodeSharedProps {
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  employeeForPosition: Map<string, Employee>;
  matchesSearch: (node: TreeNode) => boolean;
  isDirectMatch: (node: TreeNode) => boolean;
  passesShowFilter: (node: TreeNode) => boolean;
  colorIndexForPosition: (position: Position) => number;
  canViewProfiles: boolean;
  onSelectEmployee: (employeeId: string) => void;
}

function EmployeeNameControl({
  employee,
  canViewProfiles,
  onSelectEmployee,
  className,
}: {
  employee: Employee;
  canViewProfiles: boolean;
  onSelectEmployee: (employeeId: string) => void;
  className: string;
}) {
  // Sits inside another already-clickable element (the node's own toggle
  // button / list row), so this can't be a plain <button> nested inside
  // one -- stopPropagation + a click handler on a <span> gets the same
  // "click the name to open the profile" behavior without invalid nested
  // interactive markup. Falls back to plain text for callers without
  // employee.view_360, same as the shared EmployeeLink used elsewhere.
  if (!canViewProfiles) {
    return (
      <span className={className}>
        {employee.first_name} {employee.last_name}
      </span>
    );
  }
  return (
    <span
      className={`cursor-pointer hover:underline ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelectEmployee(employee.id);
      }}
    >
      {employee.first_name} {employee.last_name}
    </span>
  );
}

function OrgNode({ node, depth, ...shared }: { node: TreeNode; depth: number } & NodeSharedProps) {
  const { collapsed, onToggle, employeeForPosition, matchesSearch, isDirectMatch, passesShowFilter, colorIndexForPosition, canViewProfiles, onSelectEmployee } =
    shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const colorIndex = colorIndexForPosition(node.position);
  const borderClass = DEPARTMENT_BORDER_CLASSES[colorIndex % DEPARTMENT_BORDER_CLASSES.length];
  const isRoot = depth === 0;
  const dimmed = !passesShowFilter(node);

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.position.id)}
        className={`group relative flex w-52 flex-col gap-1.5 rounded-edge-md px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-edge-md ${tierStyle(depth, borderClass)} ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        } ${isDirectMatch(node) ? "ring-2 ring-edge-teal ring-offset-1 ring-offset-surface" : ""} ${dimmed ? "opacity-35" : ""}`}
      >
        <div className="flex items-center gap-2">
          {employee ? (
            <EmployeeAvatar
              firstName={employee.first_name}
              lastName={employee.last_name}
              colorIndex={colorIndex}
              size="sm"
              className={isRoot ? "bg-white/15 text-white" : undefined}
            />
          ) : (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${isRoot ? "bg-white/10 text-white/50" : "bg-surface3 text-text-dim"}`}
            >
              —
            </span>
          )}
          <div className="min-w-0 flex-1">
            <span className={`block truncate text-xs font-semibold leading-tight ${isRoot ? "text-white" : "text-text"}`}>{node.position.title}</span>
            {employee ? (
              <EmployeeNameControl
                employee={employee}
                canViewProfiles={canViewProfiles}
                onSelectEmployee={onSelectEmployee}
                className={`block truncate text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-text-muted"}`}
              />
            ) : (
              <span className="inline-block w-fit rounded-edge-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">Vacant</span>
            )}
          </div>
        </div>
        {hasChildren && (
          <span className={`text-[10px] ${isRoot ? "text-white/50" : "text-text-dim"}`}>
            {isCollapsed ? "▸" : "▾"} {node.children.length} direct report{node.children.length === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {hasChildren && !isCollapsed && visibleChildren.length > 0 && (
        <ul className="org-tree">
          {visibleChildren.map((child) => (
            <li key={child.position.id}>
              <OrgNode node={child} depth={depth + 1} {...shared} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeListRow({ node, depth, ...shared }: { node: TreeNode; depth: number } & NodeSharedProps) {
  const { collapsed, onToggle, employeeForPosition, matchesSearch, isDirectMatch, passesShowFilter, colorIndexForPosition, canViewProfiles, onSelectEmployee } =
    shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const colorIndex = colorIndexForPosition(node.position);
  const dimmed = !passesShowFilter(node);

  return (
    <div>
      <div
        onClick={() => hasChildren && onToggle(node.position.id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`flex items-center gap-2 rounded-edge-sm py-1.5 pr-2 text-sm ${hasChildren ? "cursor-pointer hover:bg-surface2" : ""} ${
          isDirectMatch(node) ? "bg-nav-active" : ""
        } ${dimmed ? "opacity-35" : ""}`}
      >
        <span className="w-4 text-text-dim">{hasChildren ? (isCollapsed ? "▸" : "▾") : ""}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${legendSwatchClass(colorIndex)}`} />
        <span className="font-medium text-text">{node.position.title}</span>
        {employee ? (
          <>
            <span className="text-text-dim">—</span>
            <EmployeeNameControl employee={employee} canViewProfiles={canViewProfiles} onSelectEmployee={onSelectEmployee} className="text-text-muted" />
          </>
        ) : (
          <span className="rounded-edge-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">Vacant</span>
        )}
        {hasChildren && <span className="ml-auto text-xs text-text-dim">{node.children.length} direct report(s)</span>}
      </div>
      {!isCollapsed &&
        visibleChildren.map((child) => <TreeListRow key={child.position.id} node={child} depth={depth + 1} {...shared} />)}
    </div>
  );
}
