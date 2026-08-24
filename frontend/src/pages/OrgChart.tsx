import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconClockEdit,
  IconDownload,
  IconFocus2,
  IconHierarchy3,
  IconMinus,
  IconPlus,
  IconUser,
  IconUserStar,
  IconUsers,
} from "@tabler/icons-react";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import { Button, Card, EmptyState, LoadingState, Toolbar, ToolbarDivider } from "@/components/ui";
import { usePermissions } from "@/hooks/usePermissions";
import { EmployeeAvatar } from "@/components/orgchart/EmployeeAvatar";
import { OrgChartLegend, legendSwatchClass } from "@/components/orgchart/OrgChartLegend";
import { OrgChartMinimap, type MinimapNode } from "@/components/orgchart/OrgChartMinimap";
import { EmployeeSidePanel } from "@/components/orgchart/EmployeeSidePanel";
import { DepartmentGrid, fillRateBadgeClass, type DepartmentStat } from "@/components/orgchart/DepartmentGrid";
import "./OrgChart.css";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

type ViewMode = "chart" | "list" | "department";
type ShowFilter = "all" | "active" | "vacant";

// Shared by the whole-company tree and each department's own scoped tree
// (Departments view, List view's swimlanes) -- a position is a "root" for
// whatever positions array it's given whenever isRoot says so. The
// whole-company tree's rule is "no manager"; a department's scoped tree
// additionally treats "manager belongs to a different org_unit_id" as a
// root, so a department's own swimlane/card shows its real entry point(s)
// instead of orphaning positions whose manager isn't in view.
function buildTree(positions: Position[], isRoot: (p: Position) => boolean): TreeNode[] {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const childrenOf = new Map<string, Position[]>();
  const roots: Position[] = [];

  for (const p of positions) {
    if (!isRoot(p) && p.reports_to_position_id && byId.has(p.reports_to_position_id)) {
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
}

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
// Must stay the same length and order as AVATAR_PALETTE (EmployeeAvatar.tsx)
// and SWATCH_PALETTE (OrgChartLegend.tsx) -- see those files' comments.
const DEPARTMENT_BORDER_CLASSES = [
  "border-l-[#2fc6a0]",
  "border-l-[#2fa0c6]",
  "border-l-[#2f54c6]",
  "border-l-[#542fc6]",
  "border-l-[#a02fc6]",
  "border-l-[#c62fa0]",
  "border-l-[#c62f54]",
  "border-l-[#c6542f]",
  "border-l-[#c6a02f]",
  "border-l-[#a0c62f]",
  "border-l-[#54c62f]",
  "border-l-[#2fc654]",
];

export default function OrgChart() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedDepartments, setCollapsedDepartments] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [activeDeptIds, setActiveDeptIds] = useState<Set<string>>(new Set());
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
  const orgUnitNameById = useMemo(() => new Map(unitsForCompany.map((u) => [u.id, u.name])), [unitsForCompany]);

  function colorIndexForPosition(position: Position): number {
    return orgUnitColorIndex.get(position.org_unit_id) ?? 0;
  }

  function departmentNameForPosition(position: Position): string {
    return orgUnitNameById.get(position.org_unit_id) ?? "—";
  }

  function toggleDept(id: string) {
    setActiveDeptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDepartmentCollapsed(id: string) {
    setCollapsedDepartments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const companyPositions = useMemo(() => {
    if (!positionsQuery.data) return [];
    return positionsQuery.data.filter((p) => unitIdsForCompany.has(p.org_unit_id));
  }, [positionsQuery.data, unitIdsForCompany]);

  const tree = useMemo(
    () => buildTree(companyPositions, (p) => !p.reports_to_position_id),
    [companyPositions],
  );

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

  // Per-department snapshot, computed once and shared by Departments view
  // (decision 3) and List view's swimlanes (decision 4) -- headcount/fill
  // rate always reflect the department's true state, independent of the
  // Show/search filters that only apply when browsing individual people.
  // deptTree's roots are department-scoped (a position roots its own
  // department's tree if it has no manager OR its manager sits in a
  // different org_unit_id), so a department's swimlane/card always shows
  // its own real entry point(s) instead of orphaning positions whose
  // manager isn't in view.
  const departmentStats = useMemo(() => {
    const companyPositionsById = new Map(companyPositions.map((p) => [p.id, p]));
    return unitsForCompany.map((unit) => {
      const positions = companyPositions.filter((p) => p.org_unit_id === unit.id);
      const headcount = positions.filter((p) => employeeForPosition.has(p.id)).length;
      const deptTree = buildTree(
        positions,
        (p) => !p.reports_to_position_id || companyPositionsById.get(p.reports_to_position_id)?.org_unit_id !== unit.id,
      );
      return {
        unit,
        colorIndex: orgUnitColorIndex.get(unit.id) ?? 0,
        positions,
        headcount,
        totalPositions: positions.length,
        fillRate: positions.length > 0 ? headcount / positions.length : 0,
        deptTree,
      };
    });
  }, [unitsForCompany, companyPositions, employeeForPosition, orgUnitColorIndex]);

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

  // Department chips are a second, independent filter axis from Show
  // (employee status) -- a node must pass both to render at full opacity.
  // Applied per-node rather than per top-level branch, since a manager's
  // subtree isn't guaranteed to share one department in this data model.
  const passesDeptFilter = (node: TreeNode): boolean => {
    if (activeDeptIds.size === 0) return true;
    return activeDeptIds.has(node.position.org_unit_id);
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

  // List view's swimlanes -- skip a department entirely once search has
  // narrowed it down to nothing, same "hide, don't dim" rule search already
  // uses elsewhere; with no search, every department shows (including the
  // fully-vacant ones), since seeing "0 of 3 filled" is real information.
  const visibleDepartmentGroups = departmentStats
    .map((dept) => ({ dept, roots: dept.deptTree.filter(matchesSearch) }))
    .filter(({ roots }) => !search.trim() || roots.length > 0);

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
      passesDeptFilter={passesDeptFilter}
      colorIndexForPosition={colorIndexForPosition}
      departmentNameForPosition={departmentNameForPosition}
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
          <Button variant="toolbar" size="sm" active={viewMode === "department"} onClick={() => setViewMode("department")}>
            Departments
          </Button>
        </Toolbar>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatStrip stats={stats} />
      </div>

      {(viewMode === "chart" || viewMode === "list") && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <OrgChartLegend
            departments={unitsForCompany.map((u) => ({ id: u.id, name: u.name, colorIndex: orgUnitColorIndex.get(u.id) ?? 0 }))}
            activeIds={activeDeptIds}
            onToggle={toggleDept}
            onClear={() => setActiveDeptIds(new Set())}
          />
          {viewMode === "chart" && (
            <Toolbar>
              <Button variant="toolbar" size="sm" onClick={expandAll} className="flex items-center gap-1.5">
                <IconChevronsDown size={14} /> Expand all
              </Button>
              <Button variant="toolbar" size="sm" onClick={collapseAll} className="flex items-center gap-1.5">
                <IconChevronsUp size={14} /> Collapse all
              </Button>
              <ToolbarDivider />
              <Button variant="toolbar" size="sm" onClick={() => zoomBy(-ZOOM_STEP)}>
                <IconMinus size={14} />
              </Button>
              <span className="w-10 text-center text-text-dim">{Math.round(zoom * 100)}%</span>
              <Button variant="toolbar" size="sm" onClick={() => zoomBy(ZOOM_STEP)}>
                <IconPlus size={14} />
              </Button>
              <Button variant="toolbar" size="sm" onClick={fitToScreen} className="flex items-center gap-1.5">
                <IconFocus2 size={14} /> Fit to screen
              </Button>
              <Button variant="toolbar" size="sm" onClick={toggleFullscreen} className="flex items-center gap-1.5">
                {isFullscreen ? <IconArrowsMinimize size={14} /> : <IconArrowsMaximize size={14} />}
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </Button>
              <ToolbarDivider />
              <Button variant="primary" size="sm" onClick={exportPng} disabled={isExporting || visibleRoots.length === 0} className="flex items-center gap-1.5">
                <IconDownload size={14} /> {isExporting ? "Exporting..." : "Export as PNG"}
              </Button>
            </Toolbar>
          )}
        </div>
      )}

      <div className="relative">
        <Card ref={viewportRef} className="p-6" style={{ maxHeight: "75vh", overflow: "auto" }}>
          {isLoading && <LoadingState label="Loading org chart..." />}
          {!isLoading && tree.length === 0 && <EmptyState message="No positions in this company yet." />}

          {viewMode === "list" && visibleDepartmentGroups.length > 0 && (
            <div className="flex flex-col gap-3">
              {visibleDepartmentGroups.map(({ dept, roots }) => {
                const isDeptCollapsed = collapsedDepartments.has(dept.unit.id);
                const borderClass = DEPARTMENT_BORDER_CLASSES[dept.colorIndex % DEPARTMENT_BORDER_CLASSES.length];
                const isDeptDimmed = activeDeptIds.size > 0 && !activeDeptIds.has(dept.unit.id);
                return (
                  <div key={dept.unit.id} className={`overflow-hidden rounded-edge-md border border-border ${isDeptDimmed ? "opacity-35" : ""}`}>
                    <button
                      type="button"
                      onClick={() => toggleDepartmentCollapsed(dept.unit.id)}
                      className={`flex w-full items-center gap-2 border-l-4 bg-surface2 px-3 py-2 text-left ${borderClass}`}
                    >
                      <span className="text-text-muted">{isDeptCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}</span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${legendSwatchClass(dept.colorIndex)}`} />
                      <span className="text-sm font-semibold text-text">{dept.unit.name}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-surface3 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                        {dept.headcount} of {dept.totalPositions} filled
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fillRateBadgeClass(dept.fillRate)}`}>
                        {Math.round(dept.fillRate * 100)}% staffed
                      </span>
                    </button>
                    {!isDeptCollapsed && (
                      <div className="bg-surface py-1">
                        {roots.map((node) => (
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
                            // The whole swimlane already dims above when this
                            // department isn't in activeDeptIds (every row in
                            // it would agree, by construction -- a swimlane
                            // only contains its own department's positions),
                            // so rows here always "pass" that axis -- applying
                            // it again would compound two opacity-35s into a
                            // near-invisible ~0.12.
                            passesDeptFilter={() => true}
                            colorIndexForPosition={colorIndexForPosition}
                            departmentNameForPosition={departmentNameForPosition}
                            canViewProfiles={canViewProfiles}
                            onSelectEmployee={setSelectedEmployeeId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {viewMode === "list" && !isLoading && tree.length > 0 && visibleDepartmentGroups.length === 0 && (
            <EmptyState message="No positions or people match your search." />
          )}

          {viewMode === "department" && tree.length > 0 && (
            <DepartmentGrid
              departments={departmentStats.map((dept) => {
                const [headRoot, ...extraRoots] = dept.deptTree;
                const headEmployee = headRoot ? employeeForPosition.get(headRoot.position.id) : undefined;
                const stat: DepartmentStat = {
                  id: dept.unit.id,
                  name: dept.unit.name,
                  colorIndex: dept.colorIndex,
                  headcount: dept.headcount,
                  totalPositions: dept.totalPositions,
                  fillRate: dept.fillRate,
                  headTitle: headRoot?.position.title ?? null,
                  headEmployeeName: headEmployee ? `${headEmployee.first_name} ${headEmployee.last_name}` : null,
                  extraLeads: extraRoots.length,
                };
                return stat;
              })}
              onSelect={(unitId) => {
                setActiveDeptIds(new Set([unitId]));
                setViewMode("list");
              }}
            />
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
  stats: { totalEmployees: number; departments: number; managers: number; spanOfControl: number; lastUpdated: string | null };
}) {
  // No separate "Teams" tile -- EEMS has no team entity distinct from
  // "a position with direct reports," so it would always show the exact
  // same number as Managers (confirmed live: both read 23). Two tiles that
  // can never disagree don't convey two pieces of information; showing
  // both just reads as a stat-strip bug.
  const tiles = [
    { label: "Total Employees", value: String(stats.totalEmployees), sub: "Across all departments", icon: IconUsers, accent: "bg-edge-teal" },
    { label: "Departments", value: String(stats.departments), sub: "Active org units", icon: IconBuilding, accent: "bg-info" },
    { label: "Managers", value: String(stats.managers), sub: "Incl. vacant seats", icon: IconUserStar, accent: "bg-[#542fc6]" },
    {
      label: "Span of Control",
      value: stats.spanOfControl > 0 ? stats.spanOfControl.toFixed(1) + " avg" : "—",
      sub: "Direct reports per manager",
      icon: IconHierarchy3,
      accent: "bg-warning",
    },
    { label: "Last Position Change", value: stats.lastUpdated ?? "—", sub: "Most recent update", icon: IconClockEdit, accent: "bg-[#c62fa0]" },
  ];

  return (
    <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Card key={t.label} className="relative overflow-hidden p-3.5">
          <div className={`absolute inset-x-0 top-0 h-[3px] ${t.accent}`} />
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            <t.icon size={14} className="text-text-dim" />
            {t.label}
          </p>
          <p className="mt-2 text-xl font-semibold leading-none text-text">{t.value}</p>
          <p className="mt-1.5 text-[11px] text-text-dim">{t.sub}</p>
        </Card>
      ))}
    </div>
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
  passesDeptFilter: (node: TreeNode) => boolean;
  colorIndexForPosition: (position: Position) => number;
  departmentNameForPosition: (position: Position) => string;
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
  const {
    collapsed,
    onToggle,
    employeeForPosition,
    matchesSearch,
    isDirectMatch,
    passesShowFilter,
    passesDeptFilter,
    colorIndexForPosition,
    departmentNameForPosition,
    canViewProfiles,
    onSelectEmployee,
  } = shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const colorIndex = colorIndexForPosition(node.position);
  const departmentName = departmentNameForPosition(node.position);
  const borderClass = DEPARTMENT_BORDER_CLASSES[colorIndex % DEPARTMENT_BORDER_CLASSES.length];
  const isRoot = depth === 0;
  const dimmed = !passesShowFilter(node) || !passesDeptFilter(node);

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.position.id)}
        className={`group relative flex w-52 flex-col gap-2 rounded-edge-md px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-edge-md ${tierStyle(depth, borderClass)} ${
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
              variant={isRoot ? "soft" : "solid"}
              className={isRoot ? "bg-white/15 text-white" : undefined}
            />
          ) : (
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed ${isRoot ? "border-white/30 text-white/50" : "border-text-dim text-text-dim"}`}
            >
              <IconUser size={13} />
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
              <span className={`block truncate text-[11px] italic leading-tight ${isRoot ? "text-white/50" : "text-text-dim"}`}>Open position</span>
            )}
          </div>
        </div>

        <div className={`flex items-center justify-between border-t pt-1.5 ${isRoot ? "border-white/15" : "border-border"}`}>
          <span className={`flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium ${isRoot ? "text-white/60" : "text-text-dim"}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${legendSwatchClass(colorIndex)}`} />
            <span className="truncate">{departmentName}</span>
          </span>
          {hasChildren ? (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isRoot ? "bg-white/10 text-white/70" : "bg-surface3 text-text-muted"}`}
            >
              <span className="inline-flex items-center gap-0.5">
                {isCollapsed ? <IconChevronRight size={10} /> : <IconChevronDown size={10} />}
                {node.children.length} report{node.children.length === 1 ? "" : "s"}
              </span>
            </span>
          ) : !employee ? (
            <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">Vacant</span>
          ) : null}
        </div>
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
  const { collapsed, onToggle, employeeForPosition, matchesSearch, isDirectMatch, passesShowFilter, passesDeptFilter, colorIndexForPosition, canViewProfiles, onSelectEmployee } =
    shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const colorIndex = colorIndexForPosition(node.position);
  const dimmed = !passesShowFilter(node) || !passesDeptFilter(node);

  return (
    <div>
      <div
        onClick={() => hasChildren && onToggle(node.position.id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`flex items-center gap-2 rounded-edge-sm py-1.5 pr-2 text-sm ${hasChildren ? "cursor-pointer hover:bg-surface2" : ""} ${
          isDirectMatch(node) ? "bg-nav-active" : ""
        } ${dimmed ? "opacity-35" : ""}`}
      >
        <span className="w-4 text-text-dim">{hasChildren ? (isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />) : ""}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${legendSwatchClass(colorIndex)}`} />
        <span className="font-medium text-text">{node.position.title}</span>
        {employee ? (
          <>
            <span className="text-text-dim">—</span>
            <EmployeeNameControl employee={employee} canViewProfiles={canViewProfiles} onSelectEmployee={onSelectEmployee} className="text-text-muted" />
          </>
        ) : (
          <span className="flex items-center gap-1 rounded-edge-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
            <IconUser size={10} /> Vacant
          </span>
        )}
        {hasChildren && <span className="ml-auto text-xs text-text-dim">{node.children.length} direct report(s)</span>}
      </div>
      {!isCollapsed &&
        visibleChildren.map((child) => <TreeListRow key={child.position.id} node={child} depth={depth + 1} {...shared} />)}
    </div>
  );
}
