import { createContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { apiClient } from "@/lib/apiClient";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  // True for exactly one session -- the one right after this employee's
  // very first-ever sign-in (backend's last_login_at was null going in).
  // Cleared on the next auth event so it never re-fires later in the tab.
  isFirstLogin: boolean;
}

export const AuthContext = createContext<AuthContextValue>({ session: null, loading: true, isFirstLogin: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFirstLogin, setIsFirstLogin] = useState(false);

  useEffect(() => {
    // `ignore` guards against React 18 StrictMode's dev-only double-invoke
    // of this effect (mount -> cleanup -> mount): without it, the first
    // run's getSession() promise still resolves and calls setState *after*
    // that run was already cleaned up, alongside the second run's own
    // getSession() and onAuthStateChange's initial fire -- four state
    // updates instead of two, which fanned out into every session-gated
    // query (companies, org-units, employees/me/permissions) firing twice
    // per page load. Doesn't change production behavior (StrictMode's
    // double-invoke is dev-only), but makes this effect correctly
    // idempotent either way, which is what StrictMode is checking for.
    let ignore = false;

    supabase.auth.getSession().then(({ data }) => {
      if (ignore) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (ignore) return;
      setSession(newSession);

      // Gated on SIGNED_IN specifically -- onAuthStateChange also fires on
      // TOKEN_REFRESHED (roughly hourly) and other events that aren't a
      // real new sign-in, and last_login_at should be bumped once per
      // session, not once per token refresh.
      if (event === "SIGNED_IN") {
        apiClient
          .post<{ is_first_login: boolean }>("/employees/me/touch-login", {})
          .then((res) => {
            if (!ignore) setIsFirstLogin(res.is_first_login);
          })
          .catch(() => {
            // Non-critical: worst case the welcome banner and login-
            // frequency tracking miss this one session.
          });
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading, isFirstLogin }}>{children}</AuthContext.Provider>;
}
