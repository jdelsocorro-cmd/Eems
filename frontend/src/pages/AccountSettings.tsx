import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import type { Employee, ReviewDelegation } from "@/lib/types";
import { Button, Card, ErrorBanner, FieldLabel, Spinner } from "@/components/ui";

interface EmployeeMe {
  id: string;
  first_name: string;
  last_name: string;
  work_email: string;
  status: string;
}

function employeeName(employees: Employee[] | undefined, id: string): string {
  const emp = employees?.find((e) => e.id === id);
  return emp ? `${emp.first_name} ${emp.last_name}` : id;
}

export default function AccountSettings() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [delegateId, setDelegateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const meQuery = useQuery({
    queryKey: ["employees", "me"],
    queryFn: () => apiClient.get<EmployeeMe>("/employees/me"),
    enabled: !!session,
  });

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiClient.get<Employee[]>("/employees"),
    enabled: !!session,
  });

  const delegationsQuery = useQuery({
    queryKey: ["review-delegations"],
    queryFn: () => apiClient.get<ReviewDelegation[]>("/review-delegations"),
    enabled: !!session,
  });

  const createDelegation = useMutation({
    mutationFn: () =>
      apiClient.post<ReviewDelegation>("/review-delegations", {
        delegate_employee_id: delegateId,
        start_date: startDate || null,
        end_date: endDate || null,
        reason: reason.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-delegations"] });
      setDelegateId("");
      setStartDate("");
      setEndDate("");
      setReason("");
    },
  });

  const revokeDelegation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/review-delegations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["review-delegations"] }),
  });

  function handleCreateDelegation(e: FormEvent) {
    e.preventDefault();
    if (!delegateId) return;
    createDelegation.mutate();
  }

  const given = (delegationsQuery.data ?? []).filter(
    (d) => d.delegator_employee_id === meQuery.data?.id && d.revoked_at === null,
  );
  const received = (delegationsQuery.data ?? []).filter(
    (d) => d.delegate_employee_id === meQuery.data?.id && d.revoked_at === null,
  );

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

      <Card accent className="max-w-md p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Profile</h2>
        {meQuery.isLoading && <Spinner />}
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

      <Card accent className="max-w-md p-4">
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

      <Card accent className="max-w-md p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-muted">Delegate My Reviews</h2>
        <p className="mb-3 text-xs text-text-dim">
          Temporarily hand off your default-reviewer authority (e.g. while you're out) -- no RBAC grant needed for the
          delegate. You keep your own review rights the whole time; this only adds a second eligible reviewer.
        </p>

        <div className="mb-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Currently delegated by you</p>
          <ul className="flex flex-col gap-1.5">
            {given.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-edge-sm bg-surface2 px-2 py-1.5 text-sm text-text">
                <span className="min-w-0 flex-1 truncate">
                  {employeeName(employeesQuery.data, d.delegate_employee_id)}
                  <span className="ml-1 text-xs text-text-dim">
                    ({d.start_date}
                    {d.end_date ? ` to ${d.end_date}` : " onward"})
                  </span>
                </span>
                <button
                  onClick={() => revokeDelegation.mutate(d.id)}
                  disabled={revokeDelegation.isPending}
                  className="shrink-0 text-xs text-danger hover:underline"
                >
                  Revoke
                </button>
              </li>
            ))}
            {given.length === 0 && <li className="text-sm text-text-dim">You haven't delegated to anyone.</li>}
          </ul>
          {revokeDelegation.isError && <ErrorBanner message={errorMessage(revokeDelegation.error)} />}
        </div>

        {received.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Delegated to you</p>
            <ul className="flex flex-col gap-1.5">
              {received.map((d) => (
                <li key={d.id} className="rounded-edge-sm bg-surface2 px-2 py-1.5 text-sm text-text">
                  {employeeName(employeesQuery.data, d.delegator_employee_id)}
                  <span className="ml-1 text-xs text-text-dim">
                    ({d.start_date}
                    {d.end_date ? ` to ${d.end_date}` : " onward"})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleCreateDelegation} className="flex flex-col gap-2 border-t border-border pt-3">
          <FieldLabel>Delegate to</FieldLabel>
          <select
            value={delegateId}
            onChange={(e) => setDelegateId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="" disabled>
              Choose an employee...
            </option>
            {(employeesQuery.data ?? [])
              .filter((e) => e.id !== meQuery.data?.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.first_name} {e.last_name}
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Start date</FieldLabel>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
              />
            </div>
            <div>
              <FieldLabel>End date (optional)</FieldLabel>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
              />
            </div>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
          <Button type="submit" disabled={createDelegation.isPending || !delegateId} className="self-start">
            {createDelegation.isPending ? "Delegating..." : "Delegate"}
          </Button>
          {createDelegation.isError && <ErrorBanner message={errorMessage(createDelegation.error)} />}
        </form>
      </Card>
    </div>
  );
}
