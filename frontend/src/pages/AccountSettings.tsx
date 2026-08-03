import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiClient, ApiError } from "@/lib/apiClient";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Button, Card } from "@/components/ui";

interface EmployeeMe {
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  return "Something went wrong.";
}

export default function AccountSettings() {
  const { session } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<EmployeeMe>("/employees/me"),
    enabled: !!session,
  });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Account Settings</h1>
        <p className="mt-1 text-sm text-text-muted">Manage your own account.</p>
      </div>

      <Card className="max-w-md p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Profile</h2>
        {meQuery.data && (
          <div className="text-sm text-text">
            <p className="font-medium">
              {meQuery.data.first_name} {meQuery.data.last_name}
            </p>
            <p className="text-text-muted">{meQuery.data.work_email}</p>
          </div>
        )}
        {meQuery.isError && <p className="text-sm text-danger">{errorMessage(meQuery.error)}</p>}
      </Card>

      <Card className="max-w-md p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Change password</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="newPassword" className="mb-1 block text-xs font-medium text-text-muted">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
            />
          </div>

          <div>
            <label htmlFor="confirmNewPassword" className="mb-1 block text-xs font-medium text-text-muted">
              Confirm new password
            </label>
            <input
              id="confirmNewPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          {success && <p className="text-sm text-success">Password updated.</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Updating..." : "Update password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
