-- ============================================================================
-- 049_scope_audit_log_select.sql
--
-- A security review found audit_log_select (006_rls_policies.sql:212-213)
-- was still the ORIGINAL, unscoped app.has_permission(caller, 'audit_log',
-- 'read') check -- "do you hold this grant anywhere at all," the exact same
-- bug class that 013/015/016/017/018/021/046/048 each found and fixed on
-- other tables, but this one was never revisited. Confirmed dormant, not
-- live, by direct query: this deployment currently has exactly one company,
-- and all 3 current holders of audit_log.read are Super Admin grants scoped
-- company-wide anyway. But nothing in the RBAC UI stops the HR/People Admin
-- or Read-Only Exec roles (both seeded with audit_log.read,
-- 007_seed_permissions.sql) from being granted at org_unit scope, and the
-- schema is explicitly built for multi-tenancy (a `companies` table, every
-- other business table company-scoped) -- the moment either condition
-- happens, this policy would let that holder read every OTHER company's
-- entire audit trail too, not just their own.
--
-- audit_log has no company_id column (it's a generic cross-cutting log
-- keyed by table_name/record_id across many different tables with
-- different schemas, not itself business data) -- so it can't be scoped
-- the same direct way goals/kpi_templates were. Scoping by the ACTOR's own
-- company instead: "you can read the audit trail of actions taken by
-- people in a company you have audit_log.read for." actor_employee_id is
-- nullable (system/job actions have no actor) -- those rows have no
-- natural company to scope by, so they fall back to the original unscoped
-- check rather than becoming invisible to everyone. In practice almost
-- every row has a real actor (writes go through the authenticated API),
-- so this closes the gap for the overwhelming majority of the table
-- without breaking the one edge case that can't be scoped this way.
-- ============================================================================

drop policy audit_log_select on audit_log;
create policy audit_log_select on audit_log for select
  using (
    case
      when actor_employee_id is null then app.has_permission(app.current_employee_id(), 'audit_log', 'read')
      else app.has_permission_on_company(
        app.current_employee_id(),
        app.employee_current_company_id(actor_employee_id),
        'audit_log', 'read'
      )
    end
  );
