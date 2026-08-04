import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import type { Company, Employee, EmployeeRole, OrgUnit, Permission, Position, Role, ScopeType } from "@/lib/types";
import { Button, Card, ErrorBanner, LoadingState } from "@/components/ui";

const SCOPE_TYPES: ScopeType[] = ["company", "org_unit", "position_subtree", "self"];

const SCOPE_DESCRIPTIONS: Record<ScopeType, string> = {
  company: "Applies to everything in the selected company -- every unit and position.",
  org_unit: "Applies to the selected unit and everything nested under it, at any depth.",
  position_subtree: "Applies to the selected position and everyone who reports up through it.",
  self: "Applies only to this person's own record -- no target needed.",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

export default function RbacAdmin() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: () => apiClient.get<Role[]>("/roles") });
  const permissionsQuery = useQuery({ queryKey: ["permissions"], queryFn: () => apiClient.get<Permission[]>("/permissions") });
  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });
  const unitsQuery = useQuery({ queryKey: ["org-units"], queryFn: () => apiClient.get<OrgUnit[]>("/org-units") });
  const positionsQuery = useQuery({ queryKey: ["positions"], queryFn: () => apiClient.get<Position[]>("/positions") });

  const rolePermissionsQuery = useQuery({
    queryKey: ["role-permissions", selectedRoleId],
    queryFn: () => apiClient.get<Permission[]>(`/roles/${selectedRoleId}/permissions`),
    enabled: !!selectedRoleId,
  });

  const employeeRolesQuery = useQuery({
    queryKey: ["employee-roles", selectedEmployeeId],
    queryFn: () => apiClient.get<EmployeeRole[]>(`/employee-roles?employee_id=${selectedEmployeeId}`),
    enabled: !!selectedEmployeeId,
  });

  const createRole = useMutation({
    mutationFn: (payload: { name: string; company_id: string }) => apiClient.post<Role>("/roles", payload),
    onSuccess: (role) => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setSelectedRoleId(role.id);
    },
  });

  const grantPermission = useMutation({
    mutationFn: (permissionId: string) =>
      apiClient.post(`/roles/${selectedRoleId}/permissions`, { permission_id: permissionId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["role-permissions", selectedRoleId] }),
  });

  const revokePermission = useMutation({
    mutationFn: (permissionId: string) => apiClient.delete(`/roles/${selectedRoleId}/permissions/${permissionId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["role-permissions", selectedRoleId] }),
  });

  const grantRole = useMutation({
    mutationFn: (payload: { role_id: string; scope_type: ScopeType; scope_id: string | null }) =>
      apiClient.post<EmployeeRole>("/employee-roles", { employee_id: selectedEmployeeId, ...payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-roles", selectedEmployeeId] }),
  });

  const revokeGrant = useMutation({
    mutationFn: (grantId: string) => apiClient.delete(`/employee-roles/${grantId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-roles", selectedEmployeeId] }),
  });

  const selectedRolePermissionIds = new Set((rolePermissionsQuery.data ?? []).map((p) => p.id));

  function scopeTargetLabel(scopeType: ScopeType, scopeId: string | null): string {
    if (scopeType === "self") return "";
    if (!scopeId) return "";
    if (scopeType === "company") return companiesQuery.data?.find((c) => c.id === scopeId)?.name ?? scopeId;
    if (scopeType === "org_unit") return unitsQuery.data?.find((u) => u.id === scopeId)?.name ?? scopeId;
    if (scopeType === "position_subtree") return positionsQuery.data?.find((p) => p.id === scopeId)?.title ?? scopeId;
    return scopeId;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">RBAC Admin</h1>
        <p className="mt-1 text-sm text-text-muted">Manage roles, their permissions, and who holds them at what scope.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Roles</h2>
          {rolesQuery.isLoading && <LoadingState label="Loading roles..." />}
          <ul className="mb-3 flex flex-col gap-1">
            {(rolesQuery.data ?? []).map((role) => (
              <li key={role.id}>
                <button
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`flex w-full items-center justify-between rounded-edge-sm px-2 py-1.5 text-left text-sm transition ${
                    selectedRoleId === role.id ? "bg-nav-active font-medium text-edge-teal" : "text-text hover:bg-surface2"
                  }`}
                >
                  <span>{role.name}</span>
                  {role.is_system && <span className="text-xs text-text-dim">system</span>}
                </button>
              </li>
            ))}
          </ul>

          <CreateRoleForm
            companies={companiesQuery.data ?? []}
            onSubmit={(payload) => createRole.mutate(payload)}
            pending={createRole.isPending}
          />
          {createRole.isError && <ErrorBanner message={errorMessage(createRole.error)} />}

          {selectedRoleId && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Permissions for this role</p>
              <p className="mb-2 text-xs text-text-muted">
                {rolesQuery.data?.find((r) => r.id === selectedRoleId)?.description ?? "No description set."}
              </p>
              <ul className="flex flex-col gap-1">
                {(permissionsQuery.data ?? []).map((perm) => {
                  const granted = selectedRolePermissionIds.has(perm.id);
                  return (
                    <li key={perm.id} className="flex items-center justify-between rounded-edge-sm px-2 py-1 text-sm">
                      <span className="text-text">
                        {perm.resource}.{perm.action}
                      </span>
                      <button
                        onClick={() => (granted ? revokePermission.mutate(perm.id) : grantPermission.mutate(perm.id))}
                        className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${
                          granted ? "bg-success-soft text-success" : "bg-surface2 text-text-dim hover:text-text"
                        }`}
                      >
                        {granted ? "Granted" : "Grant"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {(grantPermission.isError || revokePermission.isError) && (
                <ErrorBanner message={errorMessage(grantPermission.error ?? revokePermission.error)} />
              )}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Employee grants</h2>
          <select
            value={selectedEmployeeId ?? ""}
            onChange={(e) => setSelectedEmployeeId(e.target.value || null)}
            className="mb-3 w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Select an employee...</option>
            {(employeesQuery.data ?? []).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>

          {selectedEmployeeId && (
            <>
              <ul className="mb-3 flex flex-col gap-2">
                {(employeeRolesQuery.data ?? []).map((grant) => {
                  const role = rolesQuery.data?.find((r) => r.id === grant.role_id);
                  const targetLabel = scopeTargetLabel(grant.scope_type, grant.scope_id);
                  return (
                    <li key={grant.id} className="flex items-center justify-between rounded-edge-sm bg-surface2 p-2 text-sm">
                      <span className="text-text">
                        {role?.name ?? grant.role_id}{" "}
                        <span className="text-text-dim">
                          ({grant.scope_type}
                          {targetLabel ? `: ${targetLabel}` : ""})
                        </span>
                      </span>
                      <button
                        onClick={() => revokeGrant.mutate(grant.id)}
                        className="rounded-edge-sm px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10"
                      >
                        Revoke
                      </button>
                    </li>
                  );
                })}
                {employeeRolesQuery.data?.length === 0 && <p className="text-sm text-text-dim">No grants yet.</p>}
              </ul>
              {revokeGrant.isError && <ErrorBanner message={errorMessage(revokeGrant.error)} />}

              <GrantRoleForm
                roles={rolesQuery.data ?? []}
                companies={companiesQuery.data ?? []}
                units={unitsQuery.data ?? []}
                positions={positionsQuery.data ?? []}
                onSubmit={(payload) => grantRole.mutate(payload)}
                pending={grantRole.isPending}
              />
              {grantRole.isError && <ErrorBanner message={errorMessage(grantRole.error)} />}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function CreateRoleForm({
  companies,
  onSubmit,
  pending,
}: {
  companies: Company[];
  onSubmit: (payload: { name: string; company_id: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !companyId) return;
    onSubmit({ name: name.trim(), company_id: companyId });
    setName("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New role name"
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="">Company...</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating..." : "+ New role"}
      </Button>
    </form>
  );
}

function GrantRoleForm({
  roles,
  companies,
  units,
  positions,
  onSubmit,
  pending,
}: {
  roles: Role[];
  companies: Company[];
  units: OrgUnit[];
  positions: Position[];
  onSubmit: (payload: { role_id: string; scope_type: ScopeType; scope_id: string | null }) => void;
  pending: boolean;
}) {
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [scopeId, setScopeId] = useState("");

  const selectedRole = roles.find((r) => r.id === roleId) ?? null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!roleId) return;
    if (scopeType !== "self" && !scopeId) return;
    onSubmit({ role_id: roleId, scope_type: scopeType, scope_id: scopeType === "self" ? null : scopeId });
  }

  function handleScopeTypeChange(next: ScopeType) {
    setScopeType(next);
    setScopeId("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
      <select
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="">Role...</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      {selectedRole && <p className="text-xs text-text-muted">{selectedRole.description ?? "No description set."}</p>}

      <select
        value={scopeType}
        onChange={(e) => handleScopeTypeChange(e.target.value as ScopeType)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        {SCOPE_TYPES.map((s) => (
          <option key={s} value={s}>
            Scope: {s}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-muted">{SCOPE_DESCRIPTIONS[scopeType]}</p>

      {scopeType === "company" && (
        <select
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">Which company...</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {scopeType === "org_unit" && (
        <select
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">Which unit...</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      {scopeType === "position_subtree" && (
        <PositionScopePicker positions={positions} units={units} value={scopeId} onChange={setScopeId} />
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Granting..." : "+ Grant role"}
      </Button>
    </form>
  );
}

function PositionScopePicker({
  positions,
  units,
  value,
  onChange,
}: {
  positions: Position[];
  units: OrgUnit[];
  value: string;
  onChange: (positionId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const unitsById = new Map(units.map((u) => [u.id, u]));

  const q = search.trim().toLowerCase();
  const filtered = q
    ? positions.filter((p) => `${p.title} ${unitsById.get(p.org_unit_id)?.name ?? ""}`.toLowerCase().includes(q))
    : positions;

  const grouped = new Map<string, Position[]>();
  for (const p of filtered) {
    const groupLabel = unitsById.get(p.org_unit_id)?.name ?? "Ungrouped";
    const list = grouped.get(groupLabel) ?? [];
    list.push(p);
    grouped.set(groupLabel, list);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Filter positions..."
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
      />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        <option value="">Which position...</option>
        {[...grouped.entries()].map(([groupLabel, groupPositions]) => (
          <optgroup key={groupLabel} label={groupLabel}>
            {groupPositions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
