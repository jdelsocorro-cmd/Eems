import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Company, Employee, OrgUnit, Position, PositionAssignment, PositionScore } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

interface TreeNode {
  position: Position;
  children: TreeNode[];
}

// Every leader's score here already bakes in their whole subtree
// (app.compute_and_snapshot_position_score, 033_position_score_rollup.sql,
// walks position_closure leaves-first) -- unlike the flat org-unit-subtree
// average on the executive dashboard, a CEO's number here has genuinely
// cascaded up through every manager beneath them.
const ALL_DEPARTMENTS = "all";

export default function LeadershipScorecard() {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${new Date().getFullYear()}-12-31`);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState(ALL_DEPARTMENTS);

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });
  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: () => apiClient.get<Position[]>("/positions") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });
  const assignmentsQuery = useQuery({
    queryKey: ["position-assignments", "current"],
    queryFn: () => apiClient.get<PositionAssignment[]>("/position-assignments?current_only=true"),
  });
  const positionScoresQuery = useQuery({
    queryKey: ["position-scores"],
    queryFn: () => apiClient.get<PositionScore[]>("/scores/position-scores"),
  });

  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const computeRollup = useMutation({
    mutationFn: () =>
      apiClient.post("/scores/compute-rollup", {
        company_id: activeCompanyId,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["position-scores"] }),
  });

  function handleCompute(e: FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    computeRollup.mutate();
  }

  const unitIdsForCompany = useMemo(() => {
    if (!activeCompanyId || !unitsQuery.data) return new Set<string>();
    return new Set(unitsQuery.data.filter((u) => u.company_id === activeCompanyId).map((u) => u.id));
  }, [activeCompanyId, unitsQuery.data]);

  const companyPositions = useMemo(
    () => (positionsQuery.data ?? []).filter((p) => unitIdsForCompany.has(p.org_unit_id)),
    [positionsQuery.data, unitIdsForCompany],
  );

  const positionsById = useMemo(() => new Map(companyPositions.map((p) => [p.id, p])), [companyPositions]);

  // Department is just the position's own org_unit -- same one-hop
  // convention Users and Org Chart already use (no parent-chain walk),
  // since every position here belongs directly to a single org_unit.
  const unitsById = useMemo(() => new Map((unitsQuery.data ?? []).map((u) => [u.id, u])), [unitsQuery.data]);

  function departmentNameForPosition(position: Position): string {
    return unitsById.get(position.org_unit_id)?.name ?? "—";
  }

  const departmentOptions = useMemo(
    () => (unitsQuery.data ?? []).filter((u) => u.company_id === activeCompanyId).sort((a, b) => a.name.localeCompare(b.name)),
    [unitsQuery.data, activeCompanyId],
  );

  const tree = useMemo(() => {
    const positions = companyPositions;
    const childrenOf = new Map<string, Position[]>();
    const roots: Position[] = [];
    for (const p of positions) {
      if (p.reports_to_position_id && positionsById.has(p.reports_to_position_id)) {
        const list = childrenOf.get(p.reports_to_position_id) ?? [];
        list.push(p);
        childrenOf.set(p.reports_to_position_id, list);
      } else {
        roots.push(p);
      }
    }
    function build(position: Position): TreeNode {
      const children = (childrenOf.get(position.id) ?? []).map(build);
      return { position, children };
    }
    return roots.map(build);
  }, [companyPositions, positionsById]);

  const latestScoreByPosition = useMemo(() => {
    const map = new Map<string, PositionScore>();
    for (const s of positionScoresQuery.data ?? []) {
      const existing = map.get(s.position_id);
      if (!existing || new Date(s.computed_at) > new Date(existing.computed_at)) map.set(s.position_id, s);
    }
    return map;
  }, [positionScoresQuery.data]);

  function occupantName(positionId: string): string {
    const assignment = (assignmentsQuery.data ?? []).find((a) => a.position_id === positionId && a.is_primary);
    if (!assignment) return "Vacant";
    const emp = employeesQuery.data?.find((e) => e.id === assignment.employee_id);
    return emp ? `${emp.first_name} ${emp.last_name}` : "Vacant";
  }

  const isLoading = positionsQuery.isLoading || employeesQuery.isLoading || assignmentsQuery.isLoading || unitsQuery.isLoading;

  // A node renders if it matches the active filters itself, OR sits above
  // a descendant that does -- keeps the reporting-chain context visible
  // around a found consultant instead of orphaning them mid-tree with no
  // indentation to anchor them to.
  function nodeOwnMatches(node: TreeNode): boolean {
    if (departmentFilter !== ALL_DEPARTMENTS && node.position.org_unit_id !== departmentFilter) return false;
    const term = search.trim().toLowerCase();
    if (term && !occupantName(node.position.id).toLowerCase().includes(term) && !node.position.title.toLowerCase().includes(term)) {
      return false;
    }
    return true;
  }

  function nodeOrDescendantMatches(node: TreeNode): boolean {
    return nodeOwnMatches(node) || node.children.some(nodeOrDescendantMatches);
  }

  function renderRows(nodes: TreeNode[], depth: number): JSX.Element[] {
    return nodes.flatMap((node) => {
      if (!nodeOrDescendantMatches(node)) return [];
      const score = latestScoreByPosition.get(node.position.id);
      const row = (
        <Tr key={node.position.id}>
          <Td className="text-text" style={{ paddingLeft: `${1 + depth * 1.25}rem` }}>
            {node.position.title}
          </Td>
          <Td className="text-text-muted">{occupantName(node.position.id)}</Td>
          <Td className="text-text-muted">{departmentNameForPosition(node.position)}</Td>
          <Td className="text-text-muted">
            {score ? (score.computed_score === null ? "No active KPIs" : `${score.computed_score}%`) : "--"}
          </Td>
        </Tr>
      );
      return [row, ...renderRows(node.children, depth + 1)];
    });
  }

  const isFiltering = search.trim().length > 0 || departmentFilter !== ALL_DEPARTMENTS;
  const visibleRows = renderRows(tree, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Leadership Scorecard</h1>
          <p className="mt-1 text-sm text-text-muted">
            Recursive weighted rollup — each leader's score cascades in their whole reporting chain.
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card accent className="lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search consultant or position..."
              type="search"
              className="min-w-[200px] flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
            />
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            >
              <option value={ALL_DEPARTMENTS}>All departments</option>
              {departmentOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <Table>
            <TableHead>
              <Th>Position</Th>
              <Th>Occupant</Th>
              <Th>Department</Th>
              <Th>Rolled-up score</Th>
            </TableHead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={4}>
                    <LoadingState label="Loading positions..." />
                  </td>
                </tr>
              )}
              {visibleRows}
              {!isLoading && tree.length === 0 && <TableEmptyRow colSpan={4} message="No positions yet." />}
              {!isLoading && tree.length > 0 && isFiltering && visibleRows.length === 0 && (
                <TableEmptyRow colSpan={4} message="No consultants match your search or filter." />
              )}
            </tbody>
          </Table>
        </Card>

        <Card accent className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Compute rollup</h2>
          <p className="mb-3 text-xs text-text-dim">
            Recomputes every position's score for this company bottom-up, so managers' scores reflect their whole subtree.
          </p>
          <form onSubmit={handleCompute} className="flex flex-col gap-2">
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            />
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            />
            <Button type="submit" disabled={computeRollup.isPending || !activeCompanyId}>
              {computeRollup.isPending ? "Computing..." : "Compute rollup"}
            </Button>
            {computeRollup.isError && <ErrorBanner message={errorMessage(computeRollup.error)} />}
          </form>
          {!isLoading && tree.length === 0 && <EmptyState message="Nothing to compute yet." />}
        </Card>
      </div>
    </div>
  );
}
