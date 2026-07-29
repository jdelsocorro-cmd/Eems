import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/hooks/useAuth";

interface EmployeeMe {
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
}

export default function ExecutiveDashboard() {
  const { session } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<EmployeeMe>("/employees/me"),
    enabled: !!session,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-text">Executive Dashboard</h1>
      <p className="mt-1 text-sm text-text-muted">
        Company/department/team rollups land here in a later stage of the build (Task 10).
      </p>

      <div className="mt-6 rounded-edge-lg border border-border bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Signed in as</p>
        {isLoading && <p className="mt-1 text-sm text-text-muted">Loading...</p>}
        {error && (
          <p className="mt-1 text-sm text-danger">
            Couldn&apos;t load your employee record yet -- this is expected until the backend is deployed and an
            `employees` row exists for your account.
          </p>
        )}
        {data && (
          <p className="mt-1 text-sm text-text">
            {data.first_name} {data.last_name} &middot; {data.work_email} &middot; {data.status}
          </p>
        )}
      </div>
    </div>
  );
}
