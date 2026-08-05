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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
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
