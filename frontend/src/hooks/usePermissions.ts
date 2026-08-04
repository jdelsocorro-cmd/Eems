import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";

// Backed by GET /employees/me/permissions -- the caller's own held
// (resource, action) grants as "resource.action" strings. Single source of
// truth for what the current user can do client-side (nav visibility,
// route guards, mutation buttons) so that logic isn't duplicated per page.
// This never grants anything by itself -- RLS remains the real
// authorization boundary; this only decides what the UI shows.
export function usePermissions() {
  const { session } = useAuth();

  const query = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => apiClient.get<string[]>("/employees/me/permissions"),
    enabled: !!session,
  });

  function has(resource: string, action: string): boolean {
    return (query.data ?? []).includes(`${resource}.${action}`);
  }

  return { permissions: query.data ?? [], has, isLoading: query.isLoading };
}
