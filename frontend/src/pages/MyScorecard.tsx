import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";
import type { Employee, Goal, Kpi, KpiScore, Project, Recognition } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

function ratio(kpi: Kpi): number {
  if (kpi.direction === "higher_is_better") return kpi.target_value === 0 ? 0 : kpi.current_value / kpi.target_value;
  if (kpi.direction === "lower_is_better") return kpi.current_value === 0 ? 1 : kpi.target_value / kpi.current_value;
  return kpi.target_value === 0 ? 0 : 1 - Math.abs(kpi.current_value - kpi.target_value) / kpi.target_value;
}

export default function MyScorecard() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  const ownedGoalsQuery = useQuery({
    queryKey: ["goals", "owner", meQuery.data?.id],
    queryFn: () => apiClient.get<Goal[]>(`/goals?owner_employee_id=${meQuery.data?.id}`),
    enabled: !!meQuery.data,
  });

  const ownedProjectsQuery = useQuery({
    queryKey: ["projects", "owner", meQuery.data?.id],
    queryFn: () => apiClient.get<Project[]>(`/projects?owner_employee_id=${meQuery.data?.id}`),
    enabled: !!meQuery.data,
  });

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });

  const recognitionsQuery = useQuery({
    queryKey: ["recognitions", meQuery.data?.id],
    queryFn: () => apiClient.get<Recognition[]>(`/recognitions?employee_id=${meQuery.data?.id}`),
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
        <Card accent className="lg:col-span-2">
          <Table>
            <TableHead>
              <Th>KPI</Th>
              <Th>Progress</Th>
              <Th>Weight</Th>
              <Th>Log</Th>
            </TableHead>
            <tbody>
              {kpisQuery.isLoading && (
                <tr>
                  <td colSpan={4}>
                    <LoadingState label="Loading KPIs..." />
                  </td>
                </tr>
              )}
              {activeKpis.map((kpi) => (
                <Tr key={kpi.id}>
                  <Td className="text-text">
                    {kpi.name}
                    <span className="ml-1 text-xs text-text-dim">({kpi.direction.replace(/_/g, " ")})</span>
                  </Td>
                  <Td className="text-text-muted">
                    {kpi.current_value} / {kpi.target_value} {kpi.unit} &middot; {Math.round(ratio(kpi) * 100)}%
                  </Td>
                  <Td className="text-text-muted">{kpi.weight}</Td>
                  <Td>
                    <ProgressLogCell
                      kpi={kpi}
                      onSave={(value) => logProgress.mutate({ id: kpi.id, current_value: value })}
                      pending={logProgress.isPending}
                    />
                  </Td>
                </Tr>
              ))}
              {activeKpis.length === 0 && <TableEmptyRow colSpan={4} message="No active KPIs." />}
            </tbody>
          </Table>
          {logProgress.isError && <ErrorBanner message={errorMessage(logProgress.error)} />}
        </Card>

        <Card accent className="p-4">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Goals I own</h2>
          {ownedGoalsQuery.isLoading ? (
            <LoadingState label="Loading..." />
          ) : (ownedGoalsQuery.data ?? []).length === 0 ? (
            <EmptyState message="You don't own any goals yet." action={{ label: "Go to Goals & Performance", onClick: () => navigate("/goals") }} />
          ) : (
            <ul className="flex flex-col gap-1">
              {(ownedGoalsQuery.data ?? []).map((goal) => (
                <li key={goal.id} className="flex items-center justify-between gap-2 text-sm text-text">
                  <span className="truncate">{goal.title}</span>
                  <span className="shrink-0 rounded-edge-sm bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">
                    {goal.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Projects I own</h2>
          {ownedProjectsQuery.isLoading ? (
            <LoadingState label="Loading..." />
          ) : (ownedProjectsQuery.data ?? []).length === 0 ? (
            <EmptyState message="You don't own any projects yet." action={{ label: "Go to Projects", onClick: () => navigate("/projects") }} />
          ) : (
            <ul className="flex flex-col gap-1">
              {(ownedProjectsQuery.data ?? []).map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-2 text-sm text-text">
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 rounded-edge-sm bg-surface2 px-2 py-0.5 text-xs font-medium text-text-muted">
                    {project.status.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Recognition received</h2>
        {recognitionsQuery.isLoading ? (
          <LoadingState label="Loading..." />
        ) : (recognitionsQuery.data ?? []).length === 0 ? (
          <EmptyState message="No recognitions yet." />
        ) : (
          <ul className="flex flex-col gap-2">
            {(recognitionsQuery.data ?? []).map((r) => (
              <li key={r.id} className="rounded-edge-sm bg-surface2 p-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="rounded-edge-sm bg-edge-teal/10 px-2 py-0.5 text-xs font-medium text-edge-teal">{r.category}</span>
                  <span className="text-xs text-text-dim">
                    from {employeeName(employeesQuery.data, r.given_by)} &middot; {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 text-text">{r.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function employeeName(employees: Employee[] | undefined, id: string): string {
  const emp = employees?.find((e) => e.id === id);
  return emp ? `${emp.first_name} ${emp.last_name}` : id;
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
