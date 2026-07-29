import { createClient } from "@supabase/supabase-js";

// The anon key is safe to expose client-side by design -- RLS (see
// supabase/migrations/006_rls_policies.sql) is what actually restricts what
// this client can read/write, not secrecy of this key.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
