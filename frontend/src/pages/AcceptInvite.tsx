import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";

export default function AcceptInvite() {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-ui text-text">
      <div className="w-full max-w-sm rounded-edge-lg border border-border bg-surface p-8 shadow-edge-md">
        <div className="mb-6 text-center">
          <span className="text-2xl font-semibold text-text">
            EEMS<span className="text-edge-teal">.</span>
          </span>
          <p className="mt-1 text-sm text-text-muted">Set your password to finish setting up your account.</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-text-muted">Verifying your invite link...</p>
        ) : !session ? (
          <p className="text-center text-sm text-danger">
            This invite link is invalid or has expired. Ask an admin to send you a new one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-text-muted">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1 block text-xs font-medium text-text-muted">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 rounded-edge-md bg-edge-teal px-4 py-2 text-sm font-medium text-edge-navy transition hover:bg-edge-teal-dark disabled:opacity-50"
            >
              {submitting ? "Setting password..." : "Set password and continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
