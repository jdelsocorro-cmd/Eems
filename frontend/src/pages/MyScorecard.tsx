import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Employee, Kpi, KpiScore } from "@/lib/types";
import { Button, Card, ErrorBanner } from "@/components/ui";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function ratio(kpi: Kpi): number {
  if (kpi.direction === "higher_is_better") return kpi.target_value === 0 ? 0 : kpi.current_value / kpi.target_value;
  if (kpi.direction === "lower_is_better") return kpi.current_value === 0 ? 1 : kpi.target_value / kpi.current_value;
  return kpi.target_value === 0 ? 0 : 1 - Math.abs(kpi.current_value - kpi.target_value) / kpi.target_value;
}

export default function MyScorecard() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [periodStart, setPeriodStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${new Date().getFullYear()}-12-31`);

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<Employee>("/employees/me"),
    enabled: !!session,
  });

  const kpisQuery = useQuery({
    queryKey: ["kpis", "employee", meQuery.data?.id],
    queryFn: () => apiClient.get<Kpi[]>(`/kpis?employee_id=${meQuery.data?.id}`),
    enabled: !!meQuery.data,
  });

  const scoresQuery = useQuery({
    queryKey: ["scores", meQuery.data?.id],
    queryFn: () => apiClient.get<KpiScore[]>(`/scores?employee_id=${meQuery.data?.id}`),
    enabled: !!meQuery.data,
  });

  const logProgress = useMutation({
    mutationFn: ({ id, current_value }: { id: string; current_value: number }) =>
      apiClient.patch<Kpi>(`/kpis/${id}`, { current_value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpis", "employee", meQuery.data?.id] }),
  });

  const computeScore = useMutation({
    mutationFn: () =>
      apiClient.post<KpiScore>("/scores/compute", {
        employee_id: meQuery.data?.id,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scores", meQuery.data?.id] }),
  });

  function handleCompute(e: FormEvent) {
    e.preventDefault();
    computeScore.mutate();
  }

  const activeKpis = (kpisQuery.data ?? []).filter((k) => k.status === "active");
  const latestScore = scoresQuery.data?.[0];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">My Scorecard</h1>
        <p className="mt-1 text-sm text-text-muted">Your active KPIs, weighted score, and score history.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-2">KPI</th>
                <th className="px-4 py-2">Progress</th>
                <th className="px-4 py-2">Weight</th>
                <th className="px-4 py-2">Log</th>
              </tr>
            </thead>
            <tbody>
              {activeKpis.map((kpi) => (
                <tr key={kpi.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 text-text">
                    {kpi.name}
                    <span className="ml-1 text-xs text-text-dim">({kpi.direction.replace(/_/g, " ")})</span>
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {kpi.current_value} / {kpi.target_value} {kpi.unit} &middot; {Math.round(ratio(kpi) * 100)}%
                  </td>
                  <td className="px-4 py-2 text-text-muted">{kpi.weight}</td>
                  <td className="px-4 py-2">
                    <ProgressLogCell
                      kpi={kpi}
                      onSave={(value) => logProgress.mutate({ id: kpi.id, current_value: value })}
                      pending={logProgress.isPending}
                    />
                  </td>
                </tr>
              ))}
              {activeKpis.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-dim">
                    No active KPIs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {logProgress.isError && <ErrorBanner message={errorMessage(logProgress.error)} />}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Score</h2>

          {latestScore ? (
            <div className="mb-4">
              <p className="text-3xl font-semibold text-text">
                {latestScore.computed_score === null ? "--" : `${latestScore.computed_score}%`}
              </p>
              <p className="text-xs text-text-dim">
                {latestScore.period_start} to {latestScore.period_end}
              </p>
            </div>
          ) : (
            <p className="mb-4 text-sm text-text-dim">No score computed yet.</p>
          )}

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
            <Button type="submit" disabled={computeScore.isPending}>
              {computeScore.isPending ? "Computing..." : "Compute score for period"}
            </Button>
            {computeScore.isError && <ErrorBanner message={errorMessage(computeScore.error)} />}
          </form>

          {scoresQuery.data && scoresQuery.data.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">History</p>
              <ul className="flex flex-col gap-1 text-sm text-text-muted">
                {scoresQuery.data.map((s) => (
                  <li key={s.id}>
                    {s.period_start} to {s.period_end}: {s.computed_score === null ? "No active KPIs" : `${s.computed_score}%`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ProgressLogCell({ kpi, onSave, pending }: { kpi: Kpi; onSave: (value: number) => void; pending: boolean }) {
  const [value, setValue] = useState(String(kpi.current_value));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed !== kpi.current_value) {
      onSave(parsed);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-16 rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text"
      />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
    </form>
  );
}
