import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

import { supabase } from "@/lib/supabaseClient";
import { ReportProblemButton } from "@/components/support/ReportProblemButton";
import { usePermissions } from "@/hooks/usePermissions";

// requiredPermission gates a nav item on the caller's own grants (see
// usePermissions/GET /employees/me/permissions) -- undefined means visible
// to everyone, matching how it's always been for the non-admin items below.
// This is UI-only: RLS remains the real authorization boundary regardless
// of what's shown here. section drives the visual grouping below --
// intentionally a separate field from requiredPermission (not "gated =
// admin section"), so a future non-gated-but-admin-adjacent item can still
// land in the right group.
const NAV_ITEMS: { to: string; label: string; section: "workspace" | "admin"; requiredPermission?: [string, string] }[] = [
  { to: "/", label: "Dashboard", section: "workspace" },
  { to: "/org-chart", label: "Org Chart", section: "workspace" },
  { to: "/projects", label: "Projects", section: "workspace" },
  { to: "/tasks", label: "My Tasks", section: "workspace" },
  { to: "/review-queue", label: "Review Queue", section: "workspace" },
  { to: "/scorecard", label: "My Scorecard", section: "workspace" },
  { to: "/leadership-scorecard", label: "Leadership Scorecard", section: "workspace" },
  { to: "/performance-review-center", label: "Performance Review Center", section: "workspace" },
  { to: "/goals", label: "Goals & Performance", section: "workspace" },
  { to: "/help", label: "Help Center", section: "workspace" },
  { to: "/admin/org", label: "Org Admin", section: "admin", requiredPermission: ["org_structure", "manage"] },
  { to: "/admin/rbac", label: "RBAC Admin", section: "admin", requiredPermission: ["role", "manage"] },
  { to: "/admin/users", label: "Users", section: "admin", requiredPermission: ["employee", "create"] },
  { to: "/admin/bulk-import", label: "Bulk Import", section: "admin", requiredPermission: ["employee", "bulk_import"] },
  { to: "/admin/help", label: "Help Admin", section: "admin", requiredPermission: ["help_articles", "manage"] },
  { to: "/admin/support", label: "Support Tickets", section: "admin", requiredPermission: ["support_tickets", "review"] },
];

function NavItemLink({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        `nav-item rounded-edge-sm px-3 py-2 text-sm ${isActive ? "active bg-nav-active text-edge-teal font-medium" : "text-text-muted hover:bg-surface2"}`
      }
    >
      {item.label}
    </NavLink>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { has, isLoading: permissionsLoading } = usePermissions();

  // Hide gated items while permissions are still loading, not just when
  // denied -- otherwise a non-admin briefly sees the full admin nav flash
  // before it's filtered out.
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || (!permissionsLoading && has(...item.requiredPermission)),
  );
  const workspaceItems = visibleNavItems.filter((item) => item.section === "workspace");
  const adminItems = visibleNavItems.filter((item) => item.section === "admin");

  return (
    <div className="flex min-h-screen bg-bg font-ui text-text" data-theme="navy">
      <aside className="sidebar flex w-[var(--sidebar-w)] flex-col border-r border-border bg-surface">
        <div className="flex h-[var(--topbar-h)] items-center px-4">
          <span className="logo-text text-lg font-semibold">
            EEMS<span className="logo-accent text-edge-teal">.</span>
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {workspaceItems.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
          {adminItems.length > 0 && (
            <>
              <p className="mb-1 mt-3 px-3 text-xs font-medium uppercase tracking-wide text-text-dim">Admin</p>
              {adminItems.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-footer border-t border-border p-2">
          <Link
            to="/settings"
            className="block rounded-edge-sm px-3 py-2 text-sm text-text-muted hover:bg-surface2"
          >
            Account Settings
          </Link>
          <button
            onClick={() => supabase.auth.signOut()}
            className="theme-toggle w-full rounded-edge-sm px-3 py-2 text-left text-sm text-text-muted hover:bg-surface2"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
      <ReportProblemButton />
    </div>
  );
}
