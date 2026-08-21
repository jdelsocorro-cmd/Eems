import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Company, DashboardData, OrgUnit } from "@/lib/types";
import { Card, ErrorBanner, LoadingState } from "@/components/ui";

type ScopeType = "company" | "org_unit";

function StatusCard({ title, counts }: { title: string; counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{title}</p>
      <p className="mt-1 text-3xl font-semibold text-text">{total}</p>
      <ul className="mt-2 flex flex-col gap-0.5 text-xs text-text-muted">
        {Object.entries(counts).map(([status, n]) => (
          <li key={status} className="flex justify-between">
            <span>{status.replace(/_/g, " ")}</span>
            <span>{n}</span>
          </li>
        ))}
        {total === 0 && <li className="text-text-dim">No data in scope.</li>}
      </ul>
    </Card>
  );
}

export default function ExecutiveDashboard() {
  const { session } = useAuth();
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [scopeId, setScopeId] = useState<string>("");

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies"), enabled: !!session });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units"), enabled: !!session });

  const options: Array<{ id: string; name: string }> =
    scopeType === "company"
      ? (companiesQuery.data ?? []).map((c) => ({ id: c.id, name: c.name }))
      : (unitsQuery.data ?? []).map((u) => ({ id: u.id, name: `${u.name} (${u.unit_type})` }));

  const effectiveScopeId = scopeId || options[0]?.id || "";

  const endpoint = scopeType === "company" ? `/dashboards/executive/${effectiveScopeId}` : `/dashboards/org-unit/${effectiveScopeId}`;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", scopeType, effectiveScopeId],
    queryFn: () => apiClient.get<DashboardData>(endpoint),
    enabled: !!session && !!effectiveScopeId,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">Headcount, project/task status, goals, and average KPI score, scoped to the level you choose.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scopeType}
          onChange={(e) => {
            setScopeType(e.target.value as ScopeType);
            setScopeId("");
          }}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="company">Company (executive)</option>
          <option value="org_unit">Org unit</option>
        </select>
        <select
          value={effectiveScopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="min-w-[12rem] rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {dashboardQuery.isError && <ErrorBanner message={errorMessage(dashboardQuery.error)} />}

      {!effectiveScopeId && (companiesQuery.isLoading || unitsQuery.isLoading) && (
        <LoadingState label="Loading dashboard..." />
      )}

      {dashboardQuery.isLoading && <LoadingState label="Loading dashboard..." />}

      {dashboardQuery.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatusCard title="Headcount" counts={dashboardQuery.data.headcount.counts} />
            <StatusCard title="Projects" counts={dashboardQuery.data.projects.counts} />
            <StatusCard title="Tasks" counts={dashboardQuery.data.tasks.counts} />
            <StatusCard title="Goals" counts={dashboardQuery.data.goals.counts} />
          </div>

          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Average KPI score</p>
            <p className="mt-1 text-3xl font-semibold text-text">
              {dashboardQuery.data.average_score === null ? "--" : `${dashboardQuery.data.average_score}%`}
            </p>
            <p className="mt-1 text-xs text-text-dim">
              Based on the latest computed score for {dashboardQuery.data.scored_employee_count} employee
              {dashboardQuery.data.scored_employee_count === 1 ? "" : "s"} in scope.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
