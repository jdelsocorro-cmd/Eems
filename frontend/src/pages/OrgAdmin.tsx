import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import type { Company, Department, Position, Team } from "@/lib/types";

function ErrorBanner({ message }: { message: string }) {
  return <p className="mt-2 rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-edge-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
      {children}
    </div>
  );
}

export default function OrgAdmin() {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const companiesQuery = useQuery({
    queryKey: ["companies"],
    queryFn: () => apiClient.get<Company[]>("/companies"),
  });

  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: () => apiClient.get<Department[]>("/departments"),
  });

  const teamsQuery = useQuery({
    queryKey: ["teams"],
    queryFn: () => apiClient.get<Team[]>("/teams"),
  });

  const positionsQuery = useQuery({
    queryKey: ["positions"],
    queryFn: () => apiClient.get<Position[]>("/positions"),
  });

  const departmentsForCompany = (departmentsQuery.data ?? []).filter((d) => d.company_id === selectedCompanyId);
  const teamsForDepartment = (teamsQuery.data ?? []).filter((t) => t.department_id === selectedDepartmentId);
  const positionsForTeam = (positionsQuery.data ?? []).filter((p) => p.team_id === selectedTeamId);

  const createCompany = useMutation({
    mutationFn: (name: string) => apiClient.post<Company>("/companies", { name }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setSelectedCompanyId(company.id);
    },
  });

  const createDepartment = useMutation({
    mutationFn: (payload: { name: string; code: string }) =>
      apiClient.post<Department>("/departments", { ...payload, company_id: selectedCompanyId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
  });

  const createTeam = useMutation({
    mutationFn: (payload: { name: string; code: string }) =>
      apiClient.post<Team>("/teams", { ...payload, department_id: selectedDepartmentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams"] }),
  });

  const createPosition = useMutation({
    mutationFn: (payload: { title: string; code: string; reports_to_position_id: string | null }) =>
      apiClient.post<Position>("/positions", { ...payload, team_id: selectedTeamId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  const reparentPosition = useMutation({
    mutationFn: ({ positionId, newParentId }: { positionId: string; newParentId: string | null }) =>
      apiClient.post<Position>(`/positions/${positionId}/reparent`, {
        new_reports_to_position_id: newParentId,
        reason: "Reparented via Org Admin",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Org Admin</h1>
        <p className="mt-1 text-sm text-text-muted">
          Manage the Company → Department → Team → Position hierarchy. Reparenting a position updates the whole
          subtree and is audit-logged.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <SectionCard title="Companies">
          <EntityList
            items={(companiesQuery.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
            selectedId={selectedCompanyId}
            onSelect={(id) => {
              setSelectedCompanyId(id);
              setSelectedDepartmentId(null);
              setSelectedTeamId(null);
            }}
            loading={companiesQuery.isLoading}
          />
          <CreateForm
            placeholder="Company name"
            onSubmit={(name) => createCompany.mutate(name)}
            pending={createCompany.isPending}
          />
          {createCompany.isError && <ErrorBanner message={errorMessage(createCompany.error)} />}
        </SectionCard>

        <SectionCard title="Departments">
          {!selectedCompanyId ? (
            <EmptyHint text="Select a company first" />
          ) : (
            <>
              <EntityList
                items={departmentsForCompany.map((d) => ({ id: d.id, label: `${d.name} (${d.code})` }))}
                selectedId={selectedDepartmentId}
                onSelect={(id) => {
                  setSelectedDepartmentId(id);
                  setSelectedTeamId(null);
                }}
                loading={departmentsQuery.isLoading}
              />
              <CreateForm
                placeholder="Department name"
                withCode
                onSubmit={(name, code) => createDepartment.mutate({ name, code: code! })}
                pending={createDepartment.isPending}
              />
              {createDepartment.isError && <ErrorBanner message={errorMessage(createDepartment.error)} />}
            </>
          )}
        </SectionCard>

        <SectionCard title="Teams">
          {!selectedDepartmentId ? (
            <EmptyHint text="Select a department first" />
          ) : (
            <>
              <EntityList
                items={teamsForDepartment.map((t) => ({ id: t.id, label: `${t.name} (${t.code})` }))}
                selectedId={selectedTeamId}
                onSelect={setSelectedTeamId}
                loading={teamsQuery.isLoading}
              />
              <CreateForm
                placeholder="Team name"
                withCode
                onSubmit={(name, code) => createTeam.mutate({ name, code: code! })}
                pending={createTeam.isPending}
              />
              {createTeam.isError && <ErrorBanner message={errorMessage(createTeam.error)} />}
            </>
          )}
        </SectionCard>

        <SectionCard title="Positions">
          {!selectedTeamId ? (
            <EmptyHint text="Select a team first" />
          ) : (
            <PositionsPanel
              positions={positionsForTeam}
              allPositions={positionsQuery.data ?? []}
              onCreate={(title, code, reportsTo) => createPosition.mutate({ title, code, reports_to_position_id: reportsTo })}
              createPending={createPosition.isPending}
              createError={createPosition.isError ? errorMessage(createPosition.error) : null}
              onReparent={(positionId, newParentId) => reparentPosition.mutate({ positionId, newParentId })}
              reparentError={reparentPosition.isError ? errorMessage(reparentPosition.error) : null}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-text-dim">{text}</p>;
}

function EntityList({
  items,
  selectedId,
  onSelect,
  loading,
}: {
  items: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  if (loading) return <p className="text-sm text-text-muted">Loading...</p>;
  if (items.length === 0) return <p className="mb-3 text-sm text-text-dim">None yet.</p>;

  return (
    <ul className="mb-3 flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            onClick={() => onSelect(item.id)}
            className={`w-full rounded-edge-sm px-2 py-1.5 text-left text-sm transition ${
              selectedId === item.id
                ? "bg-nav-active font-medium text-edge-teal"
                : "text-text hover:bg-surface2"
            }`}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CreateForm({
  placeholder,
  withCode = false,
  onSubmit,
  pending,
}: {
  placeholder: string;
  withCode?: boolean;
  onSubmit: (name: string, code?: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (withCode && !code.trim())) return;
    onSubmit(name.trim(), withCode ? code.trim() : undefined);
    setName("");
    setCode("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      {withCode && (
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code (e.g. ENG)"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
      >
        {pending ? "Adding..." : "+ Add"}
      </button>
    </form>
  );
}

function PositionsPanel({
  positions,
  allPositions,
  onCreate,
  createPending,
  createError,
  onReparent,
  reparentError,
}: {
  positions: Position[];
  allPositions: Position[];
  onCreate: (title: string, code: string, reportsTo: string | null) => void;
  createPending: boolean;
  createError: string | null;
  onReparent: (positionId: string, newParentId: string | null) => void;
  reparentError: string | null;
}) {
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [reportsTo, setReportsTo] = useState<string>("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !code.trim()) return;
    onCreate(title.trim(), code.trim(), reportsTo || null);
    setTitle("");
    setCode("");
    setReportsTo("");
  }

  const positionTitle = (id: string) => allPositions.find((p) => p.id === id)?.title ?? "Unknown";

  return (
    <>
      <ul className="mb-3 flex flex-col gap-2">
        {positions.length === 0 && <p className="text-sm text-text-dim">None yet.</p>}
        {positions.map((p) => (
          <li key={p.id} className="rounded-edge-sm border border-border bg-surface2 p-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">{p.title}</span>
              <span className="text-xs text-text-dim">{p.code}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-text-muted">
                Reports to: {p.reports_to_position_id ? positionTitle(p.reports_to_position_id) : "(root)"}
              </span>
              <select
                className="ml-auto rounded-edge-sm border border-border bg-surface px-1.5 py-0.5 text-xs text-text"
                value={p.reports_to_position_id ?? ""}
                onChange={(e) => onReparent(p.id, e.target.value || null)}
              >
                <option value="">(root)</option>
                {positions
                  .filter((candidate) => candidate.id !== p.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
              </select>
            </div>
          </li>
        ))}
      </ul>
      {reparentError && <ErrorBanner message={reparentError} />}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Position title"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Code (e.g. EM1)"
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
        <select
          value={reportsTo}
          onChange={(e) => setReportsTo(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">Reports to: (root)</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              Reports to: {p.title}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={createPending}
          className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
        >
          {createPending ? "Adding..." : "+ Add position"}
        </button>
      </form>
      {createError && <ErrorBanner message={createError} />}
    </>
  );
}
