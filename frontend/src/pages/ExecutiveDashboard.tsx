import { useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconFolder, IconGauge, IconListCheck, IconTargetArrow, IconUsers, type IconProps } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Company, DashboardData, OrgUnit } from "@/lib/types";
import { Card, ErrorBanner, LoadingState } from "@/components/ui";

type ScopeType = "company" | "org_unit";

// Icon + colored top accent, matching the KPI-card treatment Org Chart's
// StatStrip already established -- this is the app's first-landed page
// after login, so it should carry at least as much visual weight as the
// page one click away. Accent colors reuse the same semantic/hue-wheel
// palette Org Chart's tiles use (teal/info/warning + two SWATCH_HEX hues)
// rather than inventing a new one.
function StatusCard({
  title,
  counts,
  icon: Icon,
  accent,
}: {
  title: string;
  counts: Record<string, number>;
  icon: ComponentType<IconProps>;
  accent: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={`absolute inset-x-0 top-0 h-[3px] ${accent}`} />
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
        <Icon size={14} className="text-text-dim" />
        {title}
      </p>
      <p className="mt-2 text-3xl font-semibold leading-none text-text">{total}</p>
      <ul className="mt-2.5 flex flex-col gap-0.5 text-xs text-text-muted">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatusCard title="Headcount" counts={dashboardQuery.data.headcount.counts} icon={IconUsers} accent="bg-edge-teal" />
          <StatusCard title="Projects" counts={dashboardQuery.data.projects.counts} icon={IconFolder} accent="bg-info" />
          <StatusCard title="Tasks" counts={dashboardQuery.data.tasks.counts} icon={IconListCheck} accent="bg-[#542fc6]" />
          <StatusCard title="Goals" counts={dashboardQuery.data.goals.counts} icon={IconTargetArrow} accent="bg-warning" />

          <Card className="relative overflow-hidden p-4">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-[#c62fa0]" />
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
              <IconGauge size={14} className="text-text-dim" />
              Average KPI score
            </p>
            <p className="mt-2 text-3xl font-semibold leading-none text-text">
              {dashboardQuery.data.average_score === null ? "--" : `${dashboardQuery.data.average_score}%`}
            </p>
            <p className="mt-2.5 text-xs text-text-dim">
              Based on the latest computed score for {dashboardQuery.data.scored_employee_count} employee
              {dashboardQuery.data.scored_employee_count === 1 ? "" : "s"} in scope.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
