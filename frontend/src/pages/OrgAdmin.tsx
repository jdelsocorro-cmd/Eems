import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChevronDown, IconChevronRight, IconDownload } from "@tabler/icons-react";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Company, OrgUnit, Position } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

// Quotes a field only when it actually needs it (contains a comma, quote,
// or newline) -- doubling any embedded quotes per the CSV spec. Position
// titles here are known to contain commas ("Recruitment and Campaign
// Specialist (Level 2)" is fine, but titles with "/" like "VP of
// Partnerships / Squad 3 Lead" could still trip a naive join).
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface UnitNode {
  unit: OrgUnit;
  children: UnitNode[];
}

// Multi-incumbent roles (several employees sharing one title, e.g. "Teacher
// Recruiter Level1") need one position row per seat -- position_assignments
// only allows a single current holder per position. Suggests the next free
// "<CODE>-N" so Duplicate doesn't require typing a code by hand, following
// the same numbered-seat convention already used for AM1-AM4.
function nextAvailableCode(baseCode: string, positionsForUnit: Position[]): string {
  const base = baseCode.toUpperCase();
  const existing = new Set(positionsForUnit.map((p) => p.code.toUpperCase()));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export default function OrgAdmin() {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [duplicatingFrom, setDuplicatingFrom] = useState<Position | null>(null);

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });
  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: () => apiClient.get<Position[]>("/positions") });

  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const createCompany = useMutation({
    mutationFn: (name: string) => apiClient.post<Company>("/companies", { name }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setSelectedCompanyId(company.id);
    },
  });

  const createUnit = useMutation({
    mutationFn: (payload: { name: string; unit_type: string; parent_unit_id: string | null }) =>
      apiClient.post<OrgUnit>("/org-units", { ...payload, company_id: activeCompanyId }),
    onSuccess: (unit) => {
      queryClient.invalidateQueries({ queryKey: ["org-units"] });
      setAddingChildOf(null);
      setSelectedUnitId(unit.id);
    },
  });

  const reparentUnit = useMutation({
    mutationFn: ({ unitId, newParentId }: { unitId: string; newParentId: string | null }) =>
      apiClient.post<OrgUnit>(`/org-units/${unitId}/reparent`, { new_parent_unit_id: newParentId, reason: "Reparented via Org Admin" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-units"] }),
  });

  const updateUnit = useMutation({
    mutationFn: ({ unitId, name, unitType }: { unitId: string; name: string; unitType: string }) =>
      apiClient.patch<OrgUnit>(`/org-units/${unitId}`, { name, unit_type: unitType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-units"] });
      setEditingUnitId(null);
    },
  });

  const deactivateUnit = useMutation({
    mutationFn: (unitId: string) => apiClient.delete(`/org-units/${unitId}`),
    onSuccess: (_data, unitId) => {
      queryClient.invalidateQueries({ queryKey: ["org-units"] });
      if (selectedUnitId === unitId) setSelectedUnitId(null);
    },
  });

  const createPosition = useMutation({
    mutationFn: (payload: { title: string; code: string; reports_to_position_id: string | null }) =>
      apiClient.post<Position>("/positions", { ...payload, org_unit_id: selectedUnitId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      setDuplicatingFrom(null);
    },
  });

  const reparentPosition = useMutation({
    mutationFn: ({ positionId, newParentId }: { positionId: string; newParentId: string | null }) =>
      apiClient.post<Position>(`/positions/${positionId}/reparent`, { new_reports_to_position_id: newParentId, reason: "Reparented via Org Admin" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  const updatePosition = useMutation({
    mutationFn: ({ positionId, title, code }: { positionId: string; title: string; code: string }) =>
      apiClient.patch<Position>(`/positions/${positionId}`, { title, code }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      setEditingPositionId(null);
    },
  });

  const deactivatePosition = useMutation({
    mutationFn: (positionId: string) => apiClient.delete(`/positions/${positionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  const movePositionToUnit = useMutation({
    mutationFn: ({ positionId, orgUnitId }: { positionId: string; orgUnitId: string }) =>
      apiClient.patch<Position>(`/positions/${positionId}`, { org_unit_id: orgUnitId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
  });

  const unitsForCompany = useMemo(
    () => (unitsQuery.data ?? []).filter((u) => u.company_id === activeCompanyId),
    [unitsQuery.data, activeCompanyId],
  );

  const tree = useMemo(() => {
    const byId = new Map(unitsForCompany.map((u) => [u.id, u]));
    const childrenOf = new Map<string, OrgUnit[]>();
    const roots: OrgUnit[] = [];
    for (const u of unitsForCompany) {
      if (u.parent_unit_id && byId.has(u.parent_unit_id)) {
        const list = childrenOf.get(u.parent_unit_id) ?? [];
        list.push(u);
        childrenOf.set(u.parent_unit_id, list);
      } else {
        roots.push(u);
      }
    }
    function build(unit: OrgUnit): UnitNode {
      return { unit, children: (childrenOf.get(unit.id) ?? []).map(build) };
    }
    return roots.map(build);
  }, [unitsForCompany]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedUnit = unitsForCompany.find((u) => u.id === selectedUnitId) ?? null;
  const positionsForUnit = (positionsQuery.data ?? []).filter((p) => p.org_unit_id === selectedUnitId);

  function exportOrgStructure() {
    const unitIds = new Set(unitsForCompany.map((u) => u.id));
    const unitNameById = new Map(unitsForCompany.map((u) => [u.id, u.name]));
    const positionsForCompany = (positionsQuery.data ?? []).filter((p) => unitIds.has(p.org_unit_id));
    const positionTitleById = new Map(positionsForCompany.map((p) => [p.id, p.title]));

    const rows: string[][] = [
      ["Department", "Position", "Code", "Reports To", "Employment Type", "Seniority Level", "Headcount Cap", "Status"],
      ...positionsForCompany
        .slice()
        .sort((a, b) => (unitNameById.get(a.org_unit_id) ?? "").localeCompare(unitNameById.get(b.org_unit_id) ?? "") || a.title.localeCompare(b.title))
        .map((p) => [
          unitNameById.get(p.org_unit_id) ?? "",
          p.title,
          p.code,
          p.reports_to_position_id ? (positionTitleById.get(p.reports_to_position_id) ?? "") : "(root)",
          p.employment_type.replace("_", " "),
          String(p.seniority_level),
          String(p.headcount_cap),
          p.is_active ? "Active" : "Inactive",
        ]),
    ];

    const companyName = (companiesQuery.data ?? []).find((c) => c.id === activeCompanyId)?.name ?? "org-structure";
    downloadCsv(`${companyName.replace(/\s+/g, "-").toLowerCase()}-org-structure.csv`, rows);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">Org Admin</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Click a unit to select it. Use <span className="font-medium">+ child</span> to add nested units of any depth (division,
            department, team -- whatever labels fit), <span className="font-medium">Move under...</span> to reorganize units, and{" "}
            <span className="font-medium">In: Move to...</span> on a position to move it between units; every change is audit-logged.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={exportOrgStructure} className="flex shrink-0 items-center gap-1.5">
          <IconDownload size={14} /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={activeCompanyId ?? ""}
          onChange={(e) => {
            setSelectedCompanyId(e.target.value);
            setSelectedUnitId(null);
          }}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text"
        >
          {(companiesQuery.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <NewCompanyForm onSubmit={(name) => createCompany.mutate(name)} pending={createCompany.isPending} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-2">
          {unitsQuery.isLoading && <LoadingState label="Loading org units..." />}
          {!unitsQuery.isLoading && tree.length === 0 && (
            <EmptyState message="No org units yet -- add the first one below." />
          )}
          {tree.map((node) => (
            <UnitRow
              key={node.unit.id}
              node={node}
              depth={0}
              collapsed={collapsed}
              onToggle={toggle}
              selectedUnitId={selectedUnitId}
              onSelect={setSelectedUnitId}
              addingChildOf={addingChildOf}
              onStartAddChild={setAddingChildOf}
              onCreateChild={(parentId, name, unitType) => createUnit.mutate({ name, unit_type: unitType, parent_unit_id: parentId })}
              createPending={createUnit.isPending}
              createError={createUnit.isError ? errorMessage(createUnit.error) : null}
              allUnits={unitsForCompany}
              onReparent={(unitId, newParentId) => reparentUnit.mutate({ unitId, newParentId })}
              editingUnitId={editingUnitId}
              onStartEdit={setEditingUnitId}
              onSubmitEdit={(unitId, name, unitType) => updateUnit.mutate({ unitId, name, unitType })}
              onCancelEdit={() => setEditingUnitId(null)}
              editPending={updateUnit.isPending}
              editError={updateUnit.isError ? errorMessage(updateUnit.error) : null}
              onDeactivate={(unitId, name) => {
                if (confirm(`Deactivate "${name}"? It will be hidden but its history is kept.`)) {
                  deactivateUnit.mutate(unitId);
                }
              }}
            />
          ))}
          <div className="mt-2 border-t border-border pt-2">
            {addingChildOf === "root" ? (
              <NewUnitForm
                onSubmit={(name, unitType) => createUnit.mutate({ name, unit_type: unitType, parent_unit_id: null })}
                onCancel={() => setAddingChildOf(null)}
                pending={createUnit.isPending}
                error={createUnit.isError ? errorMessage(createUnit.error) : null}
              />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAddingChildOf("root")}>
                + Add top-level unit
              </Button>
            )}
          </div>
        </Card>

        <Card className="p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Positions</h2>
          {!selectedUnit ? (
            <EmptyState message="Select a unit to see and manage its positions." />
          ) : (
            <>
              <p className="mb-2 text-xs text-text-muted">
                In <span className="font-medium text-text">{selectedUnit.name}</span>
              </p>
              <ul className="mb-2 flex flex-col gap-1.5">
                {positionsForUnit.length === 0 && <li className="text-xs text-text-dim">None yet.</li>}
                {positionsForUnit.map((p) =>
                  editingPositionId === p.id ? (
                    <li key={p.id} className="rounded-edge-sm bg-surface2 p-1.5">
                      <EditPositionForm
                        initialTitle={p.title}
                        initialCode={p.code}
                        onSubmit={(title, code) => updatePosition.mutate({ positionId: p.id, title, code })}
                        onCancel={() => setEditingPositionId(null)}
                        pending={updatePosition.isPending}
                        error={updatePosition.isError ? errorMessage(updatePosition.error) : null}
                      />
                    </li>
                  ) : (
                    <li key={p.id} className="rounded-edge-sm bg-surface2 p-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text">{p.title}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px] text-text-dim">{p.code}</span>
                          <button
                            onClick={() => setDuplicatingFrom(p)}
                            className="text-xs text-edge-teal hover:underline"
                          >
                            Duplicate
                          </button>
                          <button
                            onClick={() => setEditingPositionId(p.id)}
                            className="text-xs text-edge-teal hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Deactivate "${p.title}"? It will be hidden but its history is kept.`)) {
                                deactivatePosition.mutate(p.id);
                              }
                            }}
                            className="text-xs text-danger hover:underline"
                          >
                            Deactivate
                          </button>
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-text-muted">
                          Reports to:{" "}
                          {p.reports_to_position_id
                            ? positionsQuery.data?.find((x) => x.id === p.reports_to_position_id)?.title ?? "Unknown"
                            : "(root)"}
                        </span>
                        <select
                          className="ml-auto rounded-edge-sm border border-border bg-surface px-1 py-0.5 text-[10px] text-text"
                          value={p.reports_to_position_id ?? ""}
                          onChange={(e) => reparentPosition.mutate({ positionId: p.id, newParentId: e.target.value || null })}
                        >
                          <option value="">(root)</option>
                          {(positionsQuery.data ?? [])
                            .filter((candidate) => candidate.id !== p.id)
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.title}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] text-text-muted">In:</span>
                        <select
                          className="ml-auto rounded-edge-sm border border-border bg-surface px-1 py-0.5 text-[10px] text-text"
                          value={p.org_unit_id}
                          onChange={(e) => {
                            if (e.target.value !== p.org_unit_id) {
                              movePositionToUnit.mutate({ positionId: p.id, orgUnitId: e.target.value });
                            }
                          }}
                        >
                          {unitsForCompany.map((u) => (
                            <option key={u.id} value={u.id}>
                              Move to: {u.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {movePositionToUnit.isError && movePositionToUnit.variables?.positionId === p.id && (
                        <ErrorBanner message={errorMessage(movePositionToUnit.error)} />
                      )}
                    </li>
                  ),
                )}
              </ul>
              {reparentPosition.isError && <ErrorBanner message={errorMessage(reparentPosition.error)} />}
              <NewPositionForm
                key={duplicatingFrom?.id ?? "new"}
                positionsForUnit={positionsForUnit}
                initialTitle={duplicatingFrom?.title}
                initialCode={duplicatingFrom ? nextAvailableCode(duplicatingFrom.code, positionsForUnit) : undefined}
                initialReportsTo={duplicatingFrom?.reports_to_position_id ?? undefined}
                duplicatingFromTitle={duplicatingFrom?.title}
                onCancelDuplicate={duplicatingFrom ? () => setDuplicatingFrom(null) : undefined}
                onSubmit={(title, code, reportsTo) => createPosition.mutate({ title, code, reports_to_position_id: reportsTo })}
                pending={createPosition.isPending}
                error={createPosition.isError ? errorMessage(createPosition.error) : null}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function UnitRow({
  node,
  depth,
  collapsed,
  onToggle,
  selectedUnitId,
  onSelect,
  addingChildOf,
  onStartAddChild,
  onCreateChild,
  createPending,
  createError,
  allUnits,
  onReparent,
  editingUnitId,
  onStartEdit,
  onSubmitEdit,
  onCancelEdit,
  editPending,
  editError,
  onDeactivate,
}: {
  node: UnitNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedUnitId: string | null;
  onSelect: (id: string) => void;
  addingChildOf: string | null;
  onStartAddChild: (id: string) => void;
  onCreateChild: (parentId: string, name: string, unitType: string) => void;
  createPending: boolean;
  createError: string | null;
  allUnits: OrgUnit[];
  onReparent: (unitId: string, newParentId: string | null) => void;
  editingUnitId: string | null;
  onStartEdit: (id: string) => void;
  onSubmitEdit: (unitId: string, name: string, unitType: string) => void;
  onCancelEdit: () => void;
  editPending: boolean;
  editError: string | null;
  onDeactivate: (unitId: string, name: string) => void;
}) {
  const isCollapsed = collapsed.has(node.unit.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedUnitId === node.unit.id;
  const isEditing = editingUnitId === node.unit.id;

  return (
    <div>
      {isEditing ? (
        <div style={{ paddingLeft: `${depth * 18 + 6}px` }} className="py-1">
          <EditUnitForm
            initialName={node.unit.name}
            initialUnitType={node.unit.unit_type}
            onSubmit={(name, unitType) => onSubmitEdit(node.unit.id, name, unitType)}
            onCancel={onCancelEdit}
            pending={editPending}
            error={editError}
          />
        </div>
      ) : (
        <div
          style={{ paddingLeft: `${depth * 18 + 6}px` }}
          className={`flex items-center gap-1.5 rounded-edge-sm py-1 pr-1.5 text-xs ${isSelected ? "bg-nav-active" : "hover:bg-surface2"}`}
        >
          <span
            onClick={() => hasChildren && onToggle(node.unit.id)}
            className={`w-3 text-text-dim ${hasChildren ? "cursor-pointer" : ""}`}
          >
            {hasChildren ? (isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />) : ""}
          </span>
          <span onClick={() => onSelect(node.unit.id)} className="cursor-pointer font-medium text-text">
            {node.unit.name}
          </span>
          <span className="rounded-edge-sm bg-surface3 px-1 py-0.5 text-[10px] text-text-dim">{node.unit.unit_type}</span>
          <select
            className="ml-auto rounded-edge-sm border border-border bg-surface2 px-1 py-0.5 text-[10px] text-text"
            value={node.unit.parent_unit_id ?? ""}
            onChange={(e) => onReparent(node.unit.id, e.target.value || null)}
          >
            <option value="">Move under: (root)</option>
            {allUnits
              .filter((candidate) => candidate.id !== node.unit.id)
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  Move under: {candidate.name}
                </option>
              ))}
          </select>
          <button onClick={() => onStartAddChild(node.unit.id)} className="text-xs text-edge-teal hover:underline">
            + child
          </button>
          <button onClick={() => onStartEdit(node.unit.id)} className="text-xs text-edge-teal hover:underline">
            Edit
          </button>
          <button onClick={() => onDeactivate(node.unit.id, node.unit.name)} className="text-xs text-danger hover:underline">
            Deactivate
          </button>
        </div>
      )}

      {addingChildOf === node.unit.id && (
        <div style={{ paddingLeft: `${(depth + 1) * 18 + 6}px` }} className="py-1">
          <NewUnitForm
            onSubmit={(name, unitType) => onCreateChild(node.unit.id, name, unitType)}
            onCancel={() => onStartAddChild("")}
            pending={createPending}
            error={createError}
          />
        </div>
      )}

      {!isCollapsed &&
        node.children.map((child) => (
          <UnitRow
            key={child.unit.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            selectedUnitId={selectedUnitId}
            onSelect={onSelect}
            addingChildOf={addingChildOf}
            onStartAddChild={onStartAddChild}
            onCreateChild={onCreateChild}
            createPending={createPending}
            createError={createError}
            allUnits={allUnits}
            onReparent={onReparent}
            editingUnitId={editingUnitId}
            onStartEdit={onStartEdit}
            onSubmitEdit={onSubmitEdit}
            onCancelEdit={onCancelEdit}
            editPending={editPending}
            editError={editError}
            onDeactivate={onDeactivate}
          />
        ))}
    </div>
  );
}

function NewCompanyForm({ onSubmit, pending }: { onSubmit: (name: string) => void; pending: boolean }) {
  const [name, setName] = useState("");
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
    setName("");
  }
  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New company name"
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <Button type="submit" size="sm" disabled={pending}>
        + Add
      </Button>
    </form>
  );
}

function NewUnitForm({
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  onSubmit: (name: string, unitType: string) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState("department");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), unitType.trim() || "department");
    setName("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Unit name"
        autoFocus
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <input
        value={unitType}
        onChange={(e) => setUnitType(e.target.value)}
        placeholder="Type (department, team, division...)"
        className="w-40 rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function EditUnitForm({
  initialName,
  initialUnitType,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  initialName: string;
  initialUnitType: string;
  onSubmit: (name: string, unitType: string) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(initialName);
  const [unitType, setUnitType] = useState(initialUnitType);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim(), unitType.trim() || "department");
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Unit name"
        autoFocus
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <input
        value={unitType}
        onChange={(e) => setUnitType(e.target.value)}
        placeholder="Type (department, team, division...)"
        className="w-40 rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function NewPositionForm({
  positionsForUnit,
  onSubmit,
  pending,
  error,
  initialTitle,
  initialCode,
  initialReportsTo,
  duplicatingFromTitle,
  onCancelDuplicate,
}: {
  positionsForUnit: Position[];
  onSubmit: (title: string, code: string, reportsTo: string | null) => void;
  pending: boolean;
  error: string | null;
  initialTitle?: string;
  initialCode?: string;
  initialReportsTo?: string;
  duplicatingFromTitle?: string;
  onCancelDuplicate?: () => void;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [code, setCode] = useState(initialCode ?? "");
  const [reportsTo, setReportsTo] = useState(initialReportsTo ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !code.trim()) return;
    onSubmit(title.trim(), code.trim(), reportsTo || null);
    setTitle("");
    setCode("");
    setReportsTo("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 border-t border-border pt-2">
      {duplicatingFromTitle && (
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>
            Duplicating <span className="font-medium text-text">{duplicatingFromTitle}</span> — same title/reports-to, review the
            code, then Add.
          </span>
          {onCancelDuplicate && (
            <button type="button" onClick={onCancelDuplicate} className="text-edge-teal hover:underline">
              Cancel
            </button>
          )}
        </div>
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Position title"
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Code (e.g. EM1)"
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <select
        value={reportsTo}
        onChange={(e) => setReportsTo(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1 text-xs text-text"
      >
        <option value="">Reports to: (root)</option>
        {positionsForUnit.map((p) => (
          <option key={p.id} value={p.id}>
            Reports to: {p.title}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding..." : "+ Add position"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function EditPositionForm({
  initialTitle,
  initialCode,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  initialTitle: string;
  initialCode: string;
  onSubmit: (title: string, code: string) => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [code, setCode] = useState(initialCode);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !code.trim()) return;
    onSubmit(title.trim(), code.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Position title"
        autoFocus
        className="min-w-0 flex-1 rounded-edge-sm border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Code"
        className="w-16 rounded-edge-sm border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:border-border-hover"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
