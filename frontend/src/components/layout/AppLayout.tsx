import type { ComponentType, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  IconAffiliate,
  IconChartBar,
  IconClipboardCheck,
  IconClipboardList,
  IconFolder,
  IconGauge,
  IconHelpCircle,
  IconLayoutDashboard,
  IconLifebuoy,
  IconListCheck,
  IconLogout,
  IconReportAnalytics,
  IconSettings,
  IconShieldLock,
  IconSitemap,
  IconTargetArrow,
  IconTicket,
  IconUpload,
  IconUsers,
  type IconProps,
} from "@tabler/icons-react";

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
// land in the right group. icon extends the Org Chart page's icon pass
// (@tabler/icons-react) to the sidebar itself, per Jayson's reference
// screenshot -- this is the second surface to adopt the package.
const NAV_ITEMS: {
  to: string;
  label: string;
  section: "workspace" | "admin";
  icon: ComponentType<IconProps>;
  requiredPermission?: [string, string];
}[] = [
  { to: "/", label: "Dashboard", section: "workspace", icon: IconLayoutDashboard },
  { to: "/org-chart", label: "Organizational Chart", section: "workspace", icon: IconAffiliate },
  { to: "/projects", label: "Projects", section: "workspace", icon: IconFolder },
  { to: "/tasks", label: "My Tasks", section: "workspace", icon: IconListCheck },
  { to: "/review-queue", label: "Review Queue", section: "workspace", icon: IconClipboardList },
  { to: "/scorecard", label: "My Scorecard", section: "workspace", icon: IconReportAnalytics },
  { to: "/leadership-scorecard", label: "Leadership Scorecard", section: "workspace", icon: IconChartBar },
  { to: "/performance-review-center", label: "Performance Review Center", section: "workspace", icon: IconClipboardCheck },
  { to: "/goals", label: "Goals & Performance", section: "workspace", icon: IconTargetArrow },
  { to: "/help", label: "Help Center", section: "workspace", icon: IconHelpCircle },
  { to: "/admin/org", label: "Org Admin", section: "admin", icon: IconSitemap, requiredPermission: ["org_structure", "manage"] },
  { to: "/admin/rbac", label: "RBAC Admin", section: "admin", icon: IconShieldLock, requiredPermission: ["role", "manage"] },
  { to: "/admin/users", label: "Users", section: "admin", icon: IconUsers, requiredPermission: ["employee", "create"] },
  { to: "/admin/bulk-import", label: "Bulk Import", section: "admin", icon: IconUpload, requiredPermission: ["employee", "bulk_import"] },
  { to: "/admin/help", label: "Help Admin", section: "admin", icon: IconLifebuoy, requiredPermission: ["help_articles", "manage"] },
  {
    to: "/admin/kpi-templates",
    label: "KPI Templates",
    section: "admin",
    icon: IconGauge,
    requiredPermission: ["kpi_template", "manage"],
  },
  { to: "/admin/support", label: "Support Tickets", section: "admin", icon: IconTicket, requiredPermission: ["support_tickets", "review"] },
];

function NavItemLink({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        `nav-item flex items-center gap-2.5 rounded-edge-sm px-3 py-2 text-sm ${isActive ? "active bg-nav-active text-edge-teal font-medium" : "text-text-muted hover:bg-surface2"}`
      }
    >
      <item.icon size={17} className="shrink-0" stroke={1.75} />
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
        <div className="flex h-[var(--topbar-h)] items-center gap-2 px-4">
          {/* The brand kit pairs this teal/yellow "Light" colorway with dark
              surfaces (its "Dark" navy colorway is for light surfaces,
              matching its wordmark lockups) -- this sidebar is always dark
              regardless of theme, so Light is the correct mark here. */}
          <img src="/brand/edge-icon.png" alt="" width={20} height={22} className="shrink-0" />
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
            className="flex items-center gap-2.5 rounded-edge-sm px-3 py-2 text-sm text-text-muted hover:bg-surface2"
          >
            <IconSettings size={17} className="shrink-0" stroke={1.75} />
            Account Settings
          </Link>
          <button
            onClick={() => supabase.auth.signOut()}
            className="theme-toggle flex w-full items-center gap-2.5 rounded-edge-sm px-3 py-2 text-left text-sm text-text-muted hover:bg-surface2"
          >
            <IconLogout size={17} className="shrink-0" stroke={1.75} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
      <ReportProblemButton />
    </div>
  );
}
