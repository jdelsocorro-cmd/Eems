import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import type { Company, Employee, EmployeeRole, Permission, Role, ScopeType } from "@/lib/types";

const SCOPE_TYPES: ScopeType[] = ["company", "org_unit", "position_subtree", "self"];

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

function ErrorBanner({ message }: { message: string }) {
  return <p className="mt-2 rounded-edge-sm bg-danger/10 px-3 py-2 text-sm text-danger">{message}</p>;
}

export default function RbacAdmin() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: () => apiClient.get<Role[]>("/roles") });
  const permissionsQuery = useQuery({ queryKey: ["permissions"], queryFn: () => apiClient.get<Permission[]>("/permissions") });
  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: () => apiClient.get<Employee[]>("/employees") });

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">RBAC Admin</h1>
        <p className="mt-1 text-sm text-text-muted">Manage roles, their permissions, and who holds them at what scope.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-edge-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Roles</h2>
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Permissions for this role</p>
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
        </div>

        <div className="rounded-edge-lg border border-border bg-surface p-4">
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
                  return (
                    <li key={grant.id} className="flex items-center justify-between rounded-edge-sm border border-border bg-surface2 p-2 text-sm">
                      <span className="text-text">
                        {role?.name ?? grant.role_id} <span className="text-text-dim">({grant.scope_type})</span>
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
                onSubmit={(payload) => grantRole.mutate(payload)}
                pending={grantRole.isPending}
              />
              {grantRole.isError && <ErrorBanner message={errorMessage(grantRole.error)} />}
            </>
          )}
        </div>
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
      <button
        type="submit"
        disabled={pending}
        className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
      >
        {pending ? "Creating..." : "+ New role"}
      </button>
    </form>
  );
}

function GrantRoleForm({
  roles,
  companies,
  onSubmit,
  pending,
}: {
  roles: Role[];
  companies: Company[];
  onSubmit: (payload: { role_id: string; scope_type: ScopeType; scope_id: string | null }) => void;
  pending: boolean;
}) {
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("company");
  const [scopeId, setScopeId] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!roleId) return;
    if (scopeType !== "self" && !scopeId) return;
    onSubmit({ role_id: roleId, scope_type: scopeType, scope_id: scopeType === "self" ? null : scopeId });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t border-border pt-3">
      <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text">
        <option value="">Role...</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <select
        value={scopeType}
        onChange={(e) => setScopeType(e.target.value as ScopeType)}
        className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
      >
        {SCOPE_TYPES.map((s) => (
          <option key={s} value={s}>
            Scope: {s}
          </option>
        ))}
      </select>
      {scopeType !== "self" && (
        <>
          {scopeType === "company" ? (
            <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text">
              <option value="">Which company...</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder={`${scopeType} ID`}
              className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
            />
          )}
        </>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-edge-sm bg-edge-teal px-3 py-1.5 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
      >
        {pending ? "Granting..." : "+ Grant role"}
      </button>
    </form>
  );
}
