import { useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { IconFolder, IconGauge, IconLink, IconListCheck, IconSparkles, IconTargetArrow, IconUsers, IconX, type IconProps } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Company, DashboardData, OrgUnit, ScoreTrendPoint } from "@/lib/types";
import { Card, ErrorBanner, LoadingState } from "@/components/ui";

type ScopeType = "company" | "org_unit";

// Icon + a single shared accent treatment (Card's own navy->teal gradient,
// not a bespoke hue per card) -- a design review flagged the previous
// version (a different arbitrary color per card: teal/blue/purple/gold/
// pink) as decoration standing in for meaning, six hues with nothing in
// common. `concerning` is the one legitimate reason to break from the
// shared accent: it swaps to a solid warning strip, reserving color for
// the metric that actually needs attention instead of spending it on all six.
function StatusCard({
  title,
  counts,
  icon: Icon,
  concerning = false,
}: {
  title: string;
  counts: Record<string, number>;
  icon: ComponentType<IconProps>;
  concerning?: boolean;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Card accent={!concerning} className="relative overflow-hidden p-4">
      {concerning && <div className="absolute inset-x-0 top-0 h-[3px] bg-warning" />}
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

// The dashboard's one large composition below the stat row -- filling what
// was previously ~70% of empty viewport at desktop width with the metric
// that most deserves the space, rather than leaving it blank. Real period
// snapshots (kpi_scores), never a fabricated trend: below 2 points there's
// nothing to draw a line between, so it explains why instead of rendering
// an empty chart shell.
function ScoreTrendPanel({ points }: { points: ScoreTrendPoint[] }) {
  if (points.length < 2) {
    return (
      <Card accent className="p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Average KPI score trend</p>
        <p className="mt-2 text-sm text-text-dim">
          Trend appears once scores have been computed for at least two periods (My Scorecard &rarr; "Compute score for
          period"). Right now there {points.length === 1 ? "is only one snapshot" : "isn't a computed score yet"} in scope.
        </p>
      </Card>
    );
  }

  const values = points.map((p) => p.average_score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 600;
  const height = 140;
  const padding = 8;

  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padding + (height - padding * 2) * (1 - (v - min) / range);
    return [x, y] as const;
  });
  const linePoints = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
  const [lastX, lastY] = coords[coords.length - 1];
  const latest = values[values.length - 1];
  const first = values[0];
  const delta = Math.round((latest - first) * 10) / 10;

  return (
    <Card accent className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Average KPI score trend</p>
        <p className="text-xs text-text-dim">
          {delta === 0 ? "Flat" : delta > 0 ? `Up ${delta} pts` : `Down ${Math.abs(delta)} pts`} across {points.length} periods
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-36 w-full" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="var(--c-border)" strokeWidth="1" />
        <polyline points={areaPoints} fill="var(--c-green-soft)" stroke="none" />
        <polyline points={linePoints} fill="none" stroke="var(--c-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX} cy={lastY} r="4" fill="var(--c-green)" />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-text-dim">
        <span>{new Date(points[0].period_start).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
        <span>{new Date(points[points.length - 1].period_start).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
      </div>
    </Card>
  );
}

export default function ExecutiveDashboard() {
  const { session, isFirstLogin } = useAuth();
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [scopeId, setScopeId] = useState<string>("");
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

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

      {isFirstLogin && !welcomeDismissed && (
        <div className="motion-safe:animate-pop-in flex items-start gap-3 rounded-edge-md border border-edge-teal/30 bg-accent-soft px-4 py-3">
          <IconSparkles size={18} className="mt-0.5 shrink-0 text-edge-teal" />
          <div className="flex-1 text-sm text-text">
            <p className="font-medium">Welcome to EEMS.</p>
            <p className="mt-0.5 text-text-muted">
              New here? The{" "}
              <Link to="/help" className="text-edge-teal hover:underline">
                Help Center walkthrough
              </Link>{" "}
              is a quick tour of what this app tracks and how to use it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWelcomeDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-edge-sm p-1 text-text-dim hover:bg-surface2 hover:text-text"
          >
            <IconX size={16} />
          </button>
        </div>
      )}

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatusCard title="Headcount" counts={dashboardQuery.data.headcount.counts} icon={IconUsers} />
            <StatusCard title="Projects" counts={dashboardQuery.data.projects.counts} icon={IconFolder} />
            <StatusCard title="Tasks" counts={dashboardQuery.data.tasks.counts} icon={IconListCheck} />
            <StatusCard title="Goals" counts={dashboardQuery.data.goals.counts} icon={IconTargetArrow} />

            <Card
              accent={dashboardQuery.data.average_score !== null && dashboardQuery.data.average_score >= 50}
              className="relative overflow-hidden p-4"
            >
              {(dashboardQuery.data.average_score === null || dashboardQuery.data.average_score < 50) && (
                <div className="absolute inset-x-0 top-0 h-[3px] bg-warning" />
              )}
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

            <Card
              accent={dashboardQuery.data.kpi_evidence_coverage_pct !== null && dashboardQuery.data.kpi_evidence_coverage_pct >= 50}
              className="relative overflow-hidden p-4"
            >
              {(dashboardQuery.data.kpi_evidence_coverage_pct === null || dashboardQuery.data.kpi_evidence_coverage_pct < 50) && (
                <div className="absolute inset-x-0 top-0 h-[3px] bg-warning" />
              )}
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                <IconLink size={14} className="text-text-dim" />
                KPI evidence coverage
              </p>
              <p className="mt-2 text-3xl font-semibold leading-none text-text">
                {dashboardQuery.data.kpi_evidence_coverage_pct === null ? "--" : `${dashboardQuery.data.kpi_evidence_coverage_pct}%`}
              </p>
              <p className="mt-2.5 text-xs text-text-dim">
                Employees in scope with at least one active KPI backed by real linked evidence (a task, project, or milestone) --
                the rest have nothing feeding their scorecard yet.
              </p>
            </Card>
          </div>

          <ScoreTrendPanel points={dashboardQuery.data.score_trend} />
        </>
      )}
    </div>
  );
}
