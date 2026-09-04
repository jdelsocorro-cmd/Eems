import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Company, KpiDirection, KpiTemplate, OrgUnit } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

const DIRECTIONS: KpiDirection[] = ["higher_is_better", "lower_is_better", "target_is_exact"];

const DIRECTION_LABELS: Record<KpiDirection, string> = {
  higher_is_better: "Higher is better",
  lower_is_better: "Lower is better",
  target_is_exact: "Target is exact",
};

export default function KpiTemplateAdmin() {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });
  const unitsById = new Map((unitsQuery.data ?? []).map((u) => [u.id, u]));

  const templatesQuery = useQuery({
    queryKey: ["kpi-templates", "admin"],
    queryFn: () => apiClient.get<KpiTemplate[]>("/kpi-templates"),
  });

  const selectedTemplate = templatesQuery.data?.find((t) => t.id === selectedTemplateId) ?? null;

  const createTemplate = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiClient.post<KpiTemplate>("/kpi-templates", { ...payload, company_id: activeCompanyId }),
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: ["kpi-templates"] });
      setSelectedTemplateId(template.id);
      setShowCreateForm(false);
    },
  });

  const updateTemplate = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      apiClient.patch<KpiTemplate>(`/kpi-templates/${id}`, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpi-templates"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">KPI Templates</h1>
          <p className="mt-1 text-sm text-text-muted">
            Reusable KPI definitions. Company-wide templates need company-wide access to edit; a template owned by a
            department only needs that department's own KPI template access.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button onClick={() => setShowCreateForm((v) => !v)}>+ New template</Button>
        </div>
      </div>

      {showCreateForm && (
        <TemplateForm
          units={unitsQuery.data ?? []}
          pending={createTemplate.isPending}
          error={createTemplate.isError ? errorMessage(createTemplate.error) : null}
          onSubmit={(payload) => createTemplate.mutate(payload)}
          submitLabel="Create template"
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card accent className="lg:col-span-1">
          <Table>
            <TableHead>
              <Th>Name</Th>
              <Th>Owner</Th>
            </TableHead>
            <tbody>
              {templatesQuery.isLoading && (
                <tr>
                  <td colSpan={2}>
                    <LoadingState label="Loading..." />
                  </td>
                </tr>
              )}
              {(templatesQuery.data ?? []).map((template) => (
                <Tr key={template.id} onClick={() => setSelectedTemplateId(template.id)} selected={selectedTemplateId === template.id}>
                  <Td className="text-text">{template.name}</Td>
                  <Td className="text-text-muted">
                    {template.org_unit_id ? (unitsById.get(template.org_unit_id)?.name ?? "—") : "Company-wide"}
                  </Td>
                </Tr>
              ))}
              {templatesQuery.data?.length === 0 && <TableEmptyRow colSpan={2} message="No templates yet." />}
            </tbody>
          </Table>
        </Card>

        <Card accent className="p-4 lg:col-span-2">
          {!selectedTemplate ? (
            <EmptyState message="Select a template to edit it." />
          ) : (
            <TemplateForm
              key={selectedTemplate.id}
              template={selectedTemplate}
              units={unitsQuery.data ?? []}
              pending={updateTemplate.isPending}
              error={updateTemplate.isError ? errorMessage(updateTemplate.error) : null}
              onSubmit={(payload) => updateTemplate.mutate({ id: selectedTemplate.id, ...payload })}
              submitLabel="Save changes"
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function TemplateForm({
  template,
  units,
  onSubmit,
  pending,
  error,
  submitLabel,
}: {
  template?: KpiTemplate;
  units: OrgUnit[];
  onSubmit: (payload: Record<string, unknown>) => void;
  pending: boolean;
  error: string | null;
  submitLabel: string;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [unit, setUnit] = useState(template?.unit ?? "");
  const [direction, setDirection] = useState<KpiDirection>(template?.direction ?? "higher_is_better");
  const [defaultWeight, setDefaultWeight] = useState(template?.default_weight ?? 10);
  // org_unit_id is create-only (same convention as company_id) -- ownership
  // is a deliberate assignment, not something that should silently change
  // as a side effect of editing a template's other fields.
  const [orgUnitId, setOrgUnitId] = useState(template?.org_unit_id ?? "");
  const [isActive, setIsActive] = useState(template?.is_active ?? true);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      unit: unit.trim(),
      direction,
      default_weight: defaultWeight,
      is_active: isActive,
    };
    if (!template) payload.org_unit_id = orgUnitId || null;
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {!template && <h3 className="text-sm font-semibold text-text">New KPI template</h3>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Name</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div>
          <FieldLabel>Unit</FieldLabel>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="count, %, hours, $"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div>
          <FieldLabel>Direction</FieldLabel>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as KpiDirection)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel>Default weight (0-100)</FieldLabel>
          <input
            type="number"
            min={0}
            max={100}
            value={defaultWeight}
            onChange={(e) => setDefaultWeight(Number(e.target.value))}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div>
          <FieldLabel
            tooltip={<p>Who can edit this template. Locked after creation -- reassigning ownership is a deliberate action, not a field edit.</p>}
          >
            Owner
          </FieldLabel>
          {template ? (
            <p className="rounded-edge-sm bg-surface2 px-2 py-1.5 text-sm text-text-muted">
              {template.org_unit_id ? (units.find((u) => u.id === template.org_unit_id)?.name ?? "—") : "Company-wide"}
            </p>
          ) : (
            <select
              value={orgUnitId}
              onChange={(e) => setOrgUnitId(e.target.value)}
              className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
            >
              <option value="">Company-wide</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="sm:col-span-2">
          <FieldLabel>Description</FieldLabel>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
      </div>

      {template && (
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active (visible in the picker when adding a KPI)
        </label>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving..." : submitLabel}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
