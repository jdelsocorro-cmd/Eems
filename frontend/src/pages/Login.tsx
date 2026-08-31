import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui";

export default function Login() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
    }
  }

  async function handleForgotPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    // Supabase returns success here regardless of whether the email belongs
    // to a real account, so a generic confirmation is both accurate and the
    // right security posture -- it never confirms or denies an email exists.
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });

    setSubmitting(false);
    setResetSent(true);
  }

  if (forgotMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg font-ui text-text">
        <div className="w-full max-w-sm rounded-edge-lg bg-surface p-8 shadow-edge-lg">
          <div className="mb-6 text-center">
            <img src="/brand/edge-icon.png" alt="" width={28} height={30} className="mx-auto mb-2" />
            <span className="text-2xl font-semibold text-text">
              EEMS<span className="text-edge-teal">.</span>
            </span>
            <p className="mt-1 text-sm text-text-muted">Reset your password.</p>
          </div>

          {resetSent ? (
            <p className="text-center text-sm text-text">
              If an account exists for <span className="font-medium">{email}</span>, we've sent a password reset link to it.
            </p>
          ) : (
            <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
              <div>
                <label htmlFor="forgot-email" className="mb-1 block text-xs font-medium text-text-muted">
                  Work email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={submitting} className="mt-2 w-full">
                {submitting ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}

          <button
            type="button"
            onClick={() => {
              setForgotMode(false);
              setResetSent(false);
              setError(null);
            }}
            className="mt-4 w-full text-center text-xs text-edge-teal hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg font-ui text-text">
      <div className="w-full max-w-sm rounded-edge-lg bg-surface p-8 shadow-edge-lg">
        <div className="mb-6 text-center">
          <img src="/brand/edge-icon.png" alt="" width={28} height={30} className="mx-auto mb-2" />
          <span className="text-2xl font-semibold text-text">
            EEMS<span className="text-edge-teal">.</span>
          </span>
          <p className="mt-1 text-sm text-text-muted">The Human Edge in Digital Learning</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-text-muted">
              Work email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="password" className="block text-xs font-medium text-text-muted">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setForgotMode(true);
                  setError(null);
                }}
                className="text-xs text-edge-teal hover:underline"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-edge-md border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={submitting} className="mt-2 w-full">
            {submitting ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
