import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { usePermissions } from "@/hooks/usePermissions";

// Route-level guard for admin pages -- hiding the nav link (AppLayout)
// stops casual discovery, but doesn't stop someone typing the URL
// directly, so this closes that gap using the same permission data.
// UI-only, same as the nav filter: RLS is the real authorization boundary
// regardless of whether this component ever runs.
export default function RequirePermission({
  resource,
  action,
  children,
}: {
  resource: string;
  action: string;
  children: ReactNode;
}) {
  const { has, isLoading } = usePermissions();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-text-muted">Loading...</div>;
  }

  if (!has(resource, action)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
