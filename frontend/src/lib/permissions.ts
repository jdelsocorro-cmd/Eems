/**
 * Client-side permission helpers are UX-only -- hiding a button the caller
 * couldn't use anyway. They are never the actual security boundary: RLS
 * (supabase/migrations/006_rls_policies.sql) and FastAPI's
 * require_permission() (backend/app/core/deps.py) are. A user who forges a
 * client-side check still hits a 403/empty-result at the real boundary.
 *
 * This list of resource/action pairs mirrors the seeded catalog in
 * supabase/migrations/007_seed_permissions.sql -- keep them in sync if the
 * catalog changes.
 */
export type Permission =
  | "org_structure.manage"
  | "employee.create"
  | "employee.update"
  | "role.manage"
  | "project.create"
  | "project.read_all"
  | "project.update_all"
  | "kpi.update_value"
  | "kpi.update_target"
  | "kpi_template.manage"
  | "goal.manage"
  | "audit_log.read"
  | "dashboard.view_executive"
  | "employee.view_360";

export function hasPermission(granted: Permission[], permission: Permission): boolean {
  return granted.includes(permission);
}
