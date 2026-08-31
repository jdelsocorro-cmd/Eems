import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui";

const COPY = {
  invite: {
    subtitle: "Set your password to finish setting up your account.",
    verifying: "Verifying your invite link...",
    invalid: "This invite link is invalid or has expired. Ask an admin to send you a new one.",
    submitting: "Setting password...",
    submit: "Set password and continue",
  },
  reset: {
    subtitle: "Choose a new password for your account.",
    verifying: "Verifying your reset link...",
    invalid: "This reset link is invalid or has expired. Request a new one from the sign-in page.",
    submitting: "Updating password...",
    submit: "Update password and continue",
  },
};

// Shared by the invite ("set your password for the first time") and forgot-
// password ("set a new one") flows -- both land here off a Supabase link
// that carries a session token in the URL, so from this page's perspective
// they're the same action: you're now authenticated as this user, pick a
// password. Only the copy differs, via `mode`.
export default function SetPassword({ mode }: { mode: "invite" | "reset" }) {
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const copy = COPY[mode];

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
      <div className="w-full max-w-sm rounded-edge-lg bg-surface p-8 shadow-edge-lg">
        <div className="mb-6 text-center">
          <img src="/brand/edge-icon.png" alt="" width={28} height={30} className="mx-auto mb-2" />
          <span className="text-2xl font-semibold text-text">
            EEMS<span className="text-edge-teal">.</span>
          </span>
          <p className="mt-1 text-sm text-text-muted">{copy.subtitle}</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-text-muted">{copy.verifying}</p>
        ) : !session ? (
          <p className="text-center text-sm text-danger">{copy.invalid}</p>
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

            <Button type="submit" disabled={submitting} className="mt-2 w-full">
              {submitting ? copy.submitting : copy.submit}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
