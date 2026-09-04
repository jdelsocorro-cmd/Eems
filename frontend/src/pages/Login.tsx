import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui";

// A design review flagged the previous version -- a small card floating
// dead-center in an otherwise empty navy field -- as a missed brand moment:
// the very first thing every user sees, reduced to generic auth
// boilerplate. This split-panel shell gives the brand statement (the same
// vision line the Help Center walkthrough opens with) a real presence on
// desktop, and simply drops that panel on narrow viewports rather than
// squeezing it in -- the form alone is what a phone-width login actually
// needs.
function AuthShell({ children }: { children: ReactNode }) {
  // data-theme="navy" is normally set by AppLayout (post-auth) -- Login sits
  // outside that shell entirely, so without this it inherits the bare
  // :root tokens (the unused dark-mode default) and the right panel below
  // silently renders navy-on-navy instead of the intended light content
  // area. Same theme every other page in the app actually uses.
  return (
    <div className="flex min-h-screen font-ui text-text" data-theme="navy">
      <div className="relative hidden w-[44%] flex-col overflow-hidden bg-edge-navy px-12 py-12 text-white lg:flex">
        {/* Depth + signature mark -- a flat solid fill read as "background-
            color set to the brand hex," not an art-directed surface. The
            glow sits behind the vision block as its light source; the
            oversized ghosted shield bleeds off the corner as the one
            element that ties this panel back to the product itself rather
            than being swappable with any other login screen. Both purely
            decorative (aria-hidden), z-0 under the real content. */}
        <div
          className="pointer-events-none absolute -left-24 top-1/3 h-[560px] w-[560px] rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(66,228,150,0.16), transparent 70%)" }}
          aria-hidden="true"
        />
        <img
          src="/brand/edge-icon.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-20 w-[380px] opacity-[0.07]"
        />

        <div className="relative z-10 flex items-center gap-2">
          <img src="/brand/edge-icon.png" alt="" width={24} height={26} />
          <span className="text-xl font-semibold">
            EEMS<span className="text-edge-teal">.</span>
          </span>
        </div>

        {/* flex-1 + justify-center gives the vision statement one real
            center of gravity regardless of viewport height, instead of the
            previous justify-between column (logo / vision / tagline as
            three independently-spaced items, leaving two large equal but
            purposeless voids). */}
        <div className="relative z-10 flex flex-1 flex-col justify-center">
          <p className="text-xs font-bold uppercase tracking-widest text-edge-teal">The Vision</p>
          <p className="mt-3 max-w-lg text-3xl font-medium leading-snug text-white/95">
            &ldquo;Centralize every ad-hoc request, every KPI, and every goal into one system.&rdquo;
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/50">
            Instead of hunting through Slack, spreadsheets, or memory for what you asked someone to do, or how they're
            doing, EEMS answers that question.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/30">The Human Edge in Digital Learning</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <img src="/brand/edge-icon.png" alt="" width={28} height={30} className="mx-auto mb-2" />
            <span className="text-2xl font-semibold text-text">
              EEMS<span className="text-edge-teal">.</span>
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

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
      <AuthShell>
        <h1 className="mb-1 text-xl font-semibold text-text">Reset your password</h1>
        <p className="mb-6 text-sm text-text-muted">We'll email you a link to set a new one.</p>

        {resetSent ? (
          <p className="text-sm text-text">
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
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="mb-1 text-xl font-semibold text-text">Sign in</h1>
      <p className="mb-6 text-sm text-text-muted">Welcome back. Enter your work email to continue.</p>

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
    </AuthShell>
  );
}
