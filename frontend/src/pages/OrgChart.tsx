import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArrowsRightLeft,
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
  IconUserPlus,
  IconUserStar,
  IconUsers,
} from "@tabler/icons-react";

import { apiClient } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment } from "@/lib/types";
import { Button, Card, EmptyState, LoadingState, Table, TableHead, Th, Toolbar, ToolbarDivider, Tr, Td } from "@/components/ui";
import { usePermissions } from "@/hooks/usePermissions";
import { EmployeeAvatar } from "@/components/orgchart/EmployeeAvatar";
import { OrgChartLegend, legendSwatchClass } from "@/components/orgchart/OrgChartLegend";
import { EmployeeSidePanel } from "@/components/orgchart/EmployeeSidePanel";
import { AssignConsultantPanel } from "@/components/orgchart/AssignConsultantPanel";
import { ReassignManagerPanel } from "@/components/orgchart/ReassignManagerPanel";
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

// Chart view: a manager's direct reports get visually clustered by
// department the moment they span more than one -- a flat row mixing
// Lesson Support, Account Management, and Teacher Recruitment positions
// (Chief Operating Officer's real reports) reads as an undifferentiated
// wall of cards with no sense of which belongs where. Grouped by
// org_unit_id, sorted alphabetically by department name (same order the
// legend/department chips already use, via unitsForCompany), so ordering
// stays predictable. Every department present gets its own cluster, even a
// singleton -- the point is separating departments from each other, not
// just tidying up wide ones.
function groupChildrenByDepartment(
  children: TreeNode[],
  departmentNameForPosition: (position: Position) => string,
): { orgUnitId: string; nodes: TreeNode[] }[] {
  const groups = new Map<string, TreeNode[]>();
  for (const child of children) {
    const orgUnitId = child.position.org_unit_id;
    const list = groups.get(orgUnitId) ?? [];
    list.push(child);
    groups.set(orgUnitId, list);
  }
  return [...groups.entries()]
    .map(([orgUnitId, nodes]) => ({ orgUnitId, nodes }))
    .sort((a, b) => departmentNameForPosition(a.nodes[0].position).localeCompare(departmentNameForPosition(b.nodes[0].position)));
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

// Same pill treatment UserManagement.tsx's STATUS_STYLES uses for the exact
// same Employee["status"] values -- duplicated here (3 lines) rather than
// importing across pages, since UserManagement.tsx doesn't export it and
// pages in this app don't otherwise reach into each other's local consts.
const STATUS_STYLES: Record<Employee["status"], string> = {
  active: "bg-success-soft text-success",
  on_leave: "bg-warning-soft text-warning",
  offboarded: "bg-danger/10 text-danger",
};

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
  const [assigningNode, setAssigningNode] = useState<TreeNode | null>(null);
  const [reassigningNode, setReassigningNode] = useState<TreeNode | null>(null);
  const { has } = usePermissions();
  const canViewProfiles = has("employee", "view_360");
  const canAssignExisting = has("org_structure", "manage");
  const canCreateNew = has("employee", "create");
  const canAssignVacant = canAssignExisting || canCreateNew;

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

  // List view's Manager column -- a title, not the manager's employee name,
  // matching this page's own existing convention for "who reports to whom"
  // (see assigningNode/reassigningNode's reportsToTitle below): a title
  // stays meaningful even when that manager's own seat is vacant.
  function managerTitleForPosition(position: Position): string {
    if (!position.reports_to_position_id) return "—";
    return positionsById.get(position.reports_to_position_id)?.title ?? "—";
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

  const positionsById = useMemo(() => new Map(companyPositions.map((p) => [p.id, p])), [companyPositions]);

  // Focus Mode -- deliberately has no state of its own. It's fully derived
  // from selectedEmployeeId, which already exists as the trigger for
  // EmployeeSidePanel: selecting someone focuses the chart on their
  // position's subtree, and closing the panel (its own X, or the "Back to
  // Org Chart" button below) un-focuses in the same action, since both are
  // the same underlying state. nodeById/depthById give O(1) lookup of any
  // position's TreeNode and its TRUE depth in the real company hierarchy --
  // depth matters because the focused node must keep its real tier styling
  // (tierForNode/tierStyle below), not get rendered as a fake depth-0
  // "Executive" root just because it's the top of what's currently shown.
  const { nodeById, depthById } = useMemo(() => {
    const nodeMap = new Map<string, TreeNode>();
    const depthMap = new Map<string, number>();
    function walk(node: TreeNode, depth: number) {
      nodeMap.set(node.position.id, node);
      depthMap.set(node.position.id, depth);
      node.children.forEach((child) => walk(child, depth + 1));
    }
    tree.forEach((root) => walk(root, 0));
    return { nodeById: nodeMap, depthById: depthMap };
  }, [tree]);

  const positionIdForEmployeeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [positionId, employee] of employeeForPosition) {
      map.set(employee.id, positionId);
    }
    return map;
  }, [employeeForPosition]);

  const focusedPositionId = selectedEmployeeId ? positionIdForEmployeeId.get(selectedEmployeeId) ?? null : null;
  const focusedNode = focusedPositionId ? nodeById.get(focusedPositionId) ?? null : null;
  const focusedDepth = focusedPositionId ? depthById.get(focusedPositionId) ?? 0 : 0;

  // If the focused position was sitting collapsed (manual or auto-collapse),
  // focusing on it must not land the user on a single childless-looking
  // card -- reveal just that one node's own children. Deeper descendants
  // keep whatever collapse state the user already had.
  useEffect(() => {
    if (!focusedPositionId) return;
    setCollapsed((prev) => {
      if (!prev.has(focusedPositionId)) return prev;
      const next = new Set(prev);
      next.delete(focusedPositionId);
      return next;
    });
  }, [focusedPositionId]);

  // Candidates for the Assign Consultant panel's "Existing Employee" mode --
  // every active employee, not just unassigned ones, so an admin can move
  // someone out of their current seat into this one -- mirrors
  // UserManagement.tsx's standalone PositionPicker, which reassigns any
  // employee the same way and isn't limited to unassigned people either.
  // Reuses data already fetched, no new query.
  const assignableEmployees = useMemo(() => {
    return (employeesQuery.data ?? []).filter((e) => e.status === "active");
  }, [employeesQuery.data]);

  // What seat (if any) each employee would be moved OUT of -- surfaced in
  // the picker since POST /position-assignments silently closes an
  // employee's prior assignment when they're reassigned, and the picker now
  // offers people who already hold a position, not just spares.
  const currentPositionTitleByEmployee = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignmentsQuery.data ?? []) {
      if (!a.is_primary) continue;
      const position = positionsById.get(a.position_id);
      if (position) map.set(a.employee_id, position.title);
    }
    return map;
  }, [assignmentsQuery.data, positionsById]);

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

  // Same axis as passesDeptFilter, keyed directly on an org_unit_id -- used
  // to dim a whole department cluster box in Chart view as one unit, not
  // just its individual cards (matching List view's swimlane-dimming
  // precedent: dimming only the rows inside a collapsed section reads as
  // "nothing happened" until it's expanded).
  const passesDeptFilterForOrgUnit = (orgUnitId: string): boolean => {
    if (activeDeptIds.size === 0) return true;
    return activeDeptIds.has(orgUnitId);
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

  // Auto-collapse on first load of a company: only nodes that actually
  // BRANCH (more than one child) get collapsed, regardless of depth -- a
  // single-child chain (e.g. Sr. Sales Manager -> Sr. Sales Development
  // Representative -> Sales Development Representative) adds no extra
  // visual width, so collapsing it under the same flat "depth >= 1" rule
  // that keeps a wide, 30+ position chart readable was hiding real
  // positions in any department shaped as a narrow chain instead of a wide
  // tree -- confirmed live: Sales' 3rd-level position was fully correct in
  // the data, just hidden two collapses deep by that rule. The root's
  // direct reports stay visible either way (depth 0 is exempt, same as
  // before); "Collapse all" (collectIdsAtDepth(0), below) is a separate,
  // deliberate full-collapse action and is untouched by this rule.
  function collectBranchingIdsBelowRoot(): Set<string> {
    const ids = new Set<string>();
    function walk(node: TreeNode, depth: number) {
      if (depth >= 1 && node.children.length > 1) ids.add(node.position.id);
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
      setCollapsed(collectBranchingIdsBelowRoot());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, activeCompanyId]);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setNaturalSize({ width: contentRef.current.scrollWidth, height: contentRef.current.scrollHeight });
    }
  }, [tree, collapsed, search, viewMode, focusedPositionId]);

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

  // Chart view normally renders every real root at depth 0. Focus Mode
  // swaps that for a single entry -- the focused node at its TRUE depth in
  // the company hierarchy (see nodeById/depthById above), so it keeps its
  // real tier styling instead of rendering as a fake depth-0 root.
  const chartRootEntries: { node: TreeNode; depth: number }[] = focusedNode
    ? [{ node: focusedNode, depth: focusedDepth }].filter((entry) => matchesSearch(entry.node))
    : visibleRoots.map((node) => ({ node, depth: 0 }));

  const chartNodes = chartRootEntries.map(({ node, depth }) => (
    <OrgNode
      key={node.position.id}
      node={node}
      depth={depth}
      collapsed={collapsed}
      onToggle={toggle}
      employeeForPosition={employeeForPosition}
      matchesSearch={matchesSearch}
      isDirectMatch={isDirectMatch}
      isSearchActive={!!search.trim()}
      passesShowFilter={passesShowFilter}
      passesDeptFilter={passesDeptFilter}
      passesDeptFilterForOrgUnit={passesDeptFilterForOrgUnit}
      colorIndexForPosition={colorIndexForPosition}
      departmentNameForPosition={departmentNameForPosition}
      managerTitleForPosition={managerTitleForPosition}
      canViewProfiles={canViewProfiles}
      onSelectEmployee={setSelectedEmployeeId}
      selectedEmployeeId={selectedEmployeeId}
      canAssignVacant={canAssignVacant}
      onOpenAssign={setAssigningNode}
      canReassign={canAssignExisting}
      onOpenReassign={setReassigningNode}
    />
  ));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold uppercase tracking-wide text-text">Org Chart</h1>
        <p className="mt-1 text-sm text-text-muted">Explore organizational structure, reporting relationships, and team composition.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-edge-md bg-surface2 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-text-muted">
          Company
          <select
            value={activeCompanyId ?? ""}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="rounded-edge-sm border border-border bg-surface px-2 py-1.5 text-sm font-normal normal-case text-text"
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
            className="rounded-edge-sm border border-border bg-surface px-2 py-1.5 text-sm font-normal normal-case text-text"
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
            className="min-w-[200px] flex-1 rounded-edge-sm border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
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
              <Button variant="primary" size="sm" onClick={exportPng} disabled={isExporting || chartRootEntries.length === 0} className="flex items-center gap-1.5">
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
                      <span className="text-[13px] font-bold text-text">{dept.unit.name}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-surface3 px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                        {dept.headcount} of {dept.totalPositions} filled
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${fillRateBadgeClass(dept.fillRate)}`}>
                        {Math.round(dept.fillRate * 100)}% staffed
                      </span>
                    </button>
                    {!isDeptCollapsed && (
                      <div className="overflow-x-auto bg-surface">
                        <Table>
                          <TableHead>
                            <Th>Employee</Th>
                            <Th>Position</Th>
                            <Th>Org Unit</Th>
                            <Th>Manager</Th>
                            <Th className="text-right">Direct Reports</Th>
                            <Th>Status</Th>
                          </TableHead>
                          <tbody>
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
                                isSearchActive={!!search.trim()}
                                passesShowFilter={passesShowFilter}
                                // The whole swimlane already dims above when this
                                // department isn't in activeDeptIds (every row in
                                // it would agree, by construction -- a swimlane
                                // only contains its own department's positions),
                                // so rows here always "pass" that axis -- applying
                                // it again would compound two opacity-35s into a
                                // near-invisible ~0.12.
                                passesDeptFilter={() => true}
                                passesDeptFilterForOrgUnit={() => true}
                                colorIndexForPosition={colorIndexForPosition}
                                departmentNameForPosition={departmentNameForPosition}
                                managerTitleForPosition={managerTitleForPosition}
                                canViewProfiles={canViewProfiles}
                                onSelectEmployee={setSelectedEmployeeId}
                                selectedEmployeeId={selectedEmployeeId}
                                canAssignVacant={canAssignVacant}
                                onOpenAssign={setAssigningNode}
                                canReassign={false}
                                onOpenReassign={() => {}}
                              />
                            ))}
                          </tbody>
                        </Table>
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

          {viewMode === "chart" && focusedNode && (
            <div className="mb-4 flex flex-col items-start gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedEmployeeId(null)}
                className="flex items-center gap-1.5 text-sm font-medium text-edge-teal hover:underline"
              >
                <IconArrowLeft size={14} /> Back to Org Chart
              </button>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                <span>Org Chart</span>
                <span className="text-text-dim">/</span>
                <span>{departmentNameForPosition(focusedNode.position)}</span>
                <span className="text-text-dim">/</span>
                <span className="font-medium text-text">{focusedNode.position.title}</span>
              </div>
              <span className="rounded-full bg-edge-teal/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-edge-teal">
                Focused View
              </span>
            </div>
          )}

          {viewMode === "chart" &&
            chartRootEntries.length > 0 &&
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

      {selectedEmployeeId && <EmployeeSidePanel employeeId={selectedEmployeeId} onClose={() => setSelectedEmployeeId(null)} />}

      {assigningNode && (
        <AssignConsultantPanel
          position={assigningNode.position}
          departmentName={departmentNameForPosition(assigningNode.position)}
          reportsToTitle={
            assigningNode.position.reports_to_position_id
              ? positionsById.get(assigningNode.position.reports_to_position_id)?.title ?? null
              : null
          }
          directReportsCount={assigningNode.children.length}
          employees={assignableEmployees}
          currentPositionTitleByEmployee={currentPositionTitleByEmployee}
          canAssignExisting={canAssignExisting}
          canCreateNew={canCreateNew}
          onClose={() => setAssigningNode(null)}
        />
      )}

      {reassigningNode && (
        <ReassignManagerPanel
          position={reassigningNode.position}
          currentReportsToTitle={
            reassigningNode.position.reports_to_position_id
              ? positionsById.get(reassigningNode.position.reports_to_position_id)?.title ?? null
              : null
          }
          positions={companyPositions}
          units={unitsForCompany}
          onClose={() => setReassigningNode(null)}
        />
      )}
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

// Executive/Department Head are structurally reliable by depth alone (one
// hop from a root is invariant regardless of chain length elsewhere in the
// tree). Depth stops being a reliable signal below that -- a narrow chain in
// one department can put an IC at a shallower depth than a manager in a
// wider one -- so Manager vs. Individual Contributor is split on
// hasChildren instead, not depth. positions.seniority_level was considered
// and rejected as a signal: checked live, it's 0 for all 76 real rows,
// completely unpopulated.
type OrgTier = "executive" | "department_head" | "manager" | "individual_contributor";

function tierForNode(depth: number, hasChildren: boolean): OrgTier {
  if (depth === 0) return "executive";
  if (depth === 1) return "department_head";
  return hasChildren ? "manager" : "individual_contributor";
}

// Differentiated by border weight / elevation / background only -- no new
// colors. The department hue (borderClass) stays the one accent color at
// every tier; tier changes how much visual weight that same accent gets.
function tierStyle(tier: OrgTier, borderClass: string): string {
  switch (tier) {
    case "executive":
      return TIER_ROOT_STYLE;
    case "department_head":
      return `${borderClass} border-l-4 bg-surface shadow-edge-md`;
    case "manager":
      return `${borderClass} border-l-4 bg-surface2 shadow-edge-sm`;
    case "individual_contributor":
      return `${borderClass} border-l-2 bg-surface2`;
  }
}

function tierNameTextClass(tier: OrgTier, isRoot: boolean): string {
  if (isRoot) return "text-sm font-semibold text-white";
  switch (tier) {
    case "department_head":
      return "text-[13px] font-semibold text-text";
    case "manager":
      return "text-xs font-semibold text-text";
    default:
      return "text-xs font-medium text-text";
  }
}

function tierAvatarSize(tier: OrgTier): "sm" | "md" {
  return tier === "executive" || tier === "department_head" ? "md" : "sm";
}

interface NodeSharedProps {
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  employeeForPosition: Map<string, Employee>;
  matchesSearch: (node: TreeNode) => boolean;
  isDirectMatch: (node: TreeNode) => boolean;
  isSearchActive: boolean;
  passesShowFilter: (node: TreeNode) => boolean;
  passesDeptFilter: (node: TreeNode) => boolean;
  passesDeptFilterForOrgUnit: (orgUnitId: string) => boolean;
  colorIndexForPosition: (position: Position) => number;
  departmentNameForPosition: (position: Position) => string;
  managerTitleForPosition: (position: Position) => string;
  canViewProfiles: boolean;
  onSelectEmployee: (employeeId: string) => void;
  selectedEmployeeId: string | null;
  canAssignVacant: boolean;
  onOpenAssign: (node: TreeNode) => void;
  canReassign: boolean;
  onOpenReassign: (node: TreeNode) => void;
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

// Card and its own subtree render together, always -- a node's
// <div class="flex flex-col items-center"> naturally sizes to fit its own
// subtree, and sibling nodes in an <ul class="org-tree"> lay out side by
// side with connector lines that are structurally guaranteed correct,
// since the card and its children are the same DOM unit. (A prior version
// split this into a card-only component plus a separately-positioned
// "collector" row for department clusters, to keep a cluster's box
// compact -- that put the box row and the subtree row in two independent,
// separately-centered flex containers with no shared coordinate system, so
// a connector line pointing from "below the box" to a specific branch was
// geometrically arbitrary. Measured live: branches off by 400-1300px from
// their actual parent card, some closer to the wrong neighboring manager
// than their own. Reverted -- see OrgNodeChildren's clustered branch below
// for how compactness is achieved instead, without breaking this.)
function OrgNode({ node, depth, ...shared }: { node: TreeNode; depth: number } & NodeSharedProps) {
  const {
    collapsed,
    onToggle,
    employeeForPosition,
    isDirectMatch,
    passesShowFilter,
    passesDeptFilter,
    colorIndexForPosition,
    departmentNameForPosition,
    canViewProfiles,
    onSelectEmployee,
    selectedEmployeeId,
    canAssignVacant,
    onOpenAssign,
    canReassign,
    onOpenReassign,
  } = shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const colorIndex = colorIndexForPosition(node.position);
  const departmentName = departmentNameForPosition(node.position);
  const borderClass = DEPARTMENT_BORDER_CLASSES[colorIndex % DEPARTMENT_BORDER_CLASSES.length];
  const isRoot = depth === 0;
  const tier = tierForNode(depth, hasChildren);
  const isSelected = !!employee && employee.id === selectedEmployeeId;
  const dimmed = !passesShowFilter(node) || !passesDeptFilter(node);

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.position.id)}
        className={`group relative flex w-64 flex-col gap-2 rounded-edge-md px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-edge-md ${tierStyle(tier, borderClass)} ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        } ${
          isDirectMatch(node)
            ? "ring-2 ring-edge-teal ring-offset-1 ring-offset-surface"
            : isSelected
              ? "ring-1 ring-edge-teal/50 shadow-edge-glow"
              : ""
        } ${dimmed ? "opacity-35" : ""}`}
      >
        <div className="flex items-center gap-2">
          {employee ? (
            // The whole identity block (avatar + name + title) is the
            // click-to-select zone, not just the name text -- a user
            // naturally clicks wherever the person's info is, and only the
            // name line being live left clicks on the title line falling
            // through to the card's own onClick (toggle collapse) instead
            // of selecting anyone. Same nested-interactive-element pattern
            // as the reassign-manager icon and the "View Employee 360" hint
            // below: a <span role="button"> since this sits inside the
            // card's own <button>.
            <span
              role={canViewProfiles ? "button" : undefined}
              tabIndex={canViewProfiles ? 0 : undefined}
              onClick={(e) => {
                if (!canViewProfiles) return;
                e.stopPropagation();
                onSelectEmployee(employee.id);
              }}
              onKeyDown={(e) => {
                if (!canViewProfiles) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onSelectEmployee(employee.id);
                }
              }}
              className={`group/identity flex min-w-0 flex-1 items-center gap-2 ${canViewProfiles ? "cursor-pointer" : ""}`}
            >
              <EmployeeAvatar
                firstName={employee.first_name}
                lastName={employee.last_name}
                colorIndex={colorIndex}
                size={tierAvatarSize(tier)}
                variant={isRoot ? "soft" : "solid"}
                className={isRoot ? "bg-white/15 text-white" : undefined}
              />
              <div className="min-w-0 flex-1">
                <span
                  className={`block truncate leading-snug ${tierNameTextClass(tier, isRoot)} ${canViewProfiles ? "group-hover/identity:underline" : ""}`}
                >
                  {employee.first_name} {employee.last_name}
                </span>
                <span className={`block truncate text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-text-muted"}`}>{node.position.title}</span>
              </div>
            </span>
          ) : (
            <>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed ${isRoot ? "border-white/30 text-white/50" : "border-text-dim text-text-dim"}`}
              >
                <IconUser size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <span className={`block truncate text-[11px] italic leading-tight ${isRoot ? "text-white/50" : "text-text-dim"}`}>Open position</span>
                <span className={`block truncate text-[11px] leading-tight ${isRoot ? "text-white/70" : "text-text-muted"}`}>{node.position.title}</span>
              </div>
            </>
          )}
        </div>

        <div className={`flex items-center justify-between border-t pt-1.5 ${isRoot ? "border-white/15" : "border-border"}`}>
          <span className={`flex min-w-0 items-center gap-1.5 truncate text-[10px] font-medium ${isRoot ? "text-white/60" : "text-text-dim"}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${legendSwatchClass(colorIndex)}`} />
            <span className="truncate">{departmentName}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
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
            {!isRoot && canReassign && (
              <span
                role="button"
                tabIndex={0}
                title="Reassign manager"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenReassign(node);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    e.preventDefault();
                    onOpenReassign(node);
                  }
                }}
                className={`flex shrink-0 items-center justify-center rounded-full p-1 ${isRoot ? "text-white/60 hover:bg-white/10" : "text-text-dim hover:bg-surface3 hover:text-text"}`}
              >
                <IconArrowsRightLeft size={11} />
              </span>
            )}
          </span>
        </div>

        {isSelected && employee && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEmployee(employee.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onSelectEmployee(employee.id);
              }
            }}
            className={`-mt-1 block text-[10px] font-medium ${isRoot ? "text-white/80 hover:text-white" : "text-edge-teal hover:underline"}`}
          >
            View Employee 360 →
          </span>
        )}

        {!employee && canAssignVacant && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onOpenAssign(node);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onOpenAssign(node);
              }
            }}
            className={`flex items-center justify-center gap-1 rounded-edge-sm border border-dashed py-1 text-[10px] font-semibold ${
              isRoot ? "border-white/30 text-white/80 hover:bg-white/10" : "border-edge-teal/50 text-edge-teal hover:bg-edge-teal/10"
            }`}
          >
            <IconUserPlus size={11} /> Assign Consultant
          </span>
        )}
      </button>

      <OrgNodeChildren node={node} depth={depth} {...shared} />
    </div>
  );
}

// A node's children, flat or department-clustered. Recursive: a clustered
// member's own children (if any) render via this same function, so
// clustering re-applies at every level a manager's own reports happen to
// span multiple departments.
function OrgNodeChildren({ node, depth, ...shared }: { node: TreeNode; depth: number } & NodeSharedProps) {
  const { collapsed, matchesSearch, isSearchActive, colorIndexForPosition, departmentNameForPosition, passesDeptFilterForOrgUnit } = shared;
  const isCollapsed = collapsed.has(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);

  // While a search is active, a branch reveals its matching descendants
  // regardless of manual/auto collapse state -- otherwise a match sitting
  // inside a previously-collapsed branch would simply vanish instead of
  // being found, contradicting the whole point of search. Collapse state
  // itself is never mutated here, so it's exactly as the user left it the
  // moment search is cleared.
  if (!hasChildren || (isCollapsed && !isSearchActive) || visibleChildren.length === 0) return null;

  return (
    <ul className="org-tree org-tree-animate-in">
      {(() => {
        const departmentGroups = groupChildrenByDepartment(visibleChildren, departmentNameForPosition);
        // Only cluster when there's actually more than one department to
        // tell apart -- a single-department manager (the common case)
        // renders exactly as before, one plain <li> per child.
        if (departmentGroups.length <= 1) {
          return visibleChildren.map((child) => (
            <li key={child.position.id}>
              <OrgNode node={child} depth={depth + 1} {...shared} />
            </li>
          ));
        }
        return departmentGroups.map((group) => {
          const groupColorIndex = colorIndexForPosition(group.nodes[0].position);
          const groupDeptName = departmentNameForPosition(group.nodes[0].position);
          const groupDimmed = !passesDeptFilterForOrgUnit(group.orgUnitId);
          return (
            <li key={group.orgUnitId}>
              <div className={`flex flex-col items-center gap-1 ${groupDimmed ? "opacity-35" : ""}`}>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${legendSwatchClass(groupColorIndex)}`} />
                  {groupDeptName}
                </div>
                {/* No box/border here deliberately -- each member is a full
                    OrgNode (card + its own subtree, together), so this row
                    can be as wide as the widest member's subtree needs
                    without anything trying to visually contain it. A
                    border trying to wrap that width is what broke both the
                    box-sizing (fc454f5) and the connector-line alignment
                    (this fix) in the two designs that came before this
                    one. */}
                <div className="flex flex-wrap items-start justify-center gap-3">
                  {group.nodes.map((child) => (
                    <OrgNode key={child.position.id} node={child} depth={depth + 1} {...shared} />
                  ))}
                </div>
              </div>
            </li>
          );
        });
      })()}
    </ul>
  );
}

// Renders as a real <Tr> (via the shared Table primitives), one per
// department swimlane's <tbody> -- Employee | Position | Org Unit | Manager |
// Direct Reports | Status, per the redesign brief's "useful for operational
// scanning" ask. Recursive: returns itself plus its own children's rows as a
// Fragment, so <tbody> ends up with a flat list of <tr> siblings (a Fragment
// contributes no DOM node of its own, so this is valid table markup) while
// hierarchy stays visible via the Employee cell's own indentation.
function TreeListRow({ node, depth, ...shared }: { node: TreeNode; depth: number } & NodeSharedProps) {
  const {
    collapsed,
    onToggle,
    employeeForPosition,
    matchesSearch,
    isDirectMatch,
    isSearchActive,
    passesShowFilter,
    passesDeptFilter,
    colorIndexForPosition,
    departmentNameForPosition,
    managerTitleForPosition,
    canViewProfiles,
    onSelectEmployee,
    selectedEmployeeId,
    canAssignVacant,
    onOpenAssign,
  } = shared;
  const isCollapsed = collapsed.has(node.position.id);
  const employee = employeeForPosition.get(node.position.id);
  const hasChildren = node.children.length > 0;
  const visibleChildren = node.children.filter(matchesSearch);
  const colorIndex = colorIndexForPosition(node.position);
  const dimmed = !passesShowFilter(node) || !passesDeptFilter(node);
  const isSelected = !!employee && employee.id === selectedEmployeeId;

  return (
    <>
      <Tr
        onClick={() => hasChildren && onToggle(node.position.id)}
        selected={isSelected}
        className={`${hasChildren ? "cursor-pointer" : ""} ${isDirectMatch(node) ? "bg-nav-active" : ""} ${dimmed ? "opacity-35" : ""}`}
      >
        <Td>
          <div className="flex items-center gap-2.5" style={{ paddingLeft: `${depth * 20}px` }}>
            <span className="w-4 shrink-0 text-text-dim">
              {hasChildren ? isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} /> : null}
            </span>
            <span className={`h-2 w-2 shrink-0 rounded-full ${legendSwatchClass(colorIndex)}`} />
            {employee ? (
              <EmployeeNameControl employee={employee} canViewProfiles={canViewProfiles} onSelectEmployee={onSelectEmployee} className="truncate font-medium text-text" />
            ) : (
              // Deliberately quieter than a colored pill here -- the Status
              // column's own "Vacant" pill (further right) already carries
              // that signal; this cell just needs to read as "no one here."
              <span className="truncate text-xs italic text-text-dim">Open position</span>
            )}
            {!employee && canAssignVacant && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAssign(node);
                }}
                className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-edge-teal/50 px-2 py-0.5 text-[10px] font-semibold text-edge-teal hover:bg-edge-teal/10"
              >
                <IconUserPlus size={10} /> Assign
              </button>
            )}
          </div>
        </Td>
        <Td className="text-text-muted">{node.position.title}</Td>
        <Td className="text-text-muted">{departmentNameForPosition(node.position)}</Td>
        <Td className="text-text-muted">{managerTitleForPosition(node.position)}</Td>
        <Td className="text-right text-text-muted">{hasChildren ? node.children.length : "—"}</Td>
        <Td>
          {employee ? (
            <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[employee.status]}`}>{employee.status.replace(/_/g, " ")}</span>
          ) : (
            <span className="rounded-edge-sm bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">Vacant</span>
          )}
        </Td>
      </Tr>
      {(!isCollapsed || isSearchActive) &&
        visibleChildren.map((child) => <TreeListRow key={child.position.id} node={child} depth={depth + 1} {...shared} />)}
    </>
  );
}
