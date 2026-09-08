import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import App from "./App";
import { AuthProvider } from "@/store/AuthProvider";
import "./index.css";

// Default staleTime is 0, which makes every query refetch on every mount --
// navigating away from a page and back re-fetches everything from the
// network even if nothing changed, which reads as "loading" again on data
// that was already sitting in memory. 30s is enough to make in-app
// navigation feel instant on repeat visits within a session while still
// keeping data reasonably fresh; explicit invalidateQueries() calls after
// mutations (already used throughout the app) still force a refetch
// immediately regardless of this window.
//
// refetchOnWindowFocus is disabled for the same reason: react-query's focus
// manager treats any `visibilitychange` event as a "window focus" (not just
// a genuine OS-level focus change), so it fires far more often than the name
// suggests -- switching browser tabs, opening DevTools, or an OS-level app
// switch all trigger it. With the default (true), every query mounted on
// Dashboard/My Tasks (companies, org-units, employees/me/permissions, etc.)
// was refetching in a duplicate wave on top of its initial mount fetch, even
// though staleTime already made the refetch pointless (verified: request
// count to /companies went from 2 to 1 per load with this off). Confirmed
// live in both dev and a production build, so this isn't a StrictMode
// artifact.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
