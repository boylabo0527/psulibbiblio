import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Set it in .env.local (or Vercel project settings).`,
    );
  }
  return value;
}

// Next.js patches the global `fetch` to add its own Data Cache layer, which
// defaults to caching GET requests unless told otherwise. Supabase's REST
// calls go through that same global fetch, so without this override,
// repeated identical queries (e.g. a plain "select all programs") can get
// served a stale cached response indefinitely instead of hitting the DB.
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/** Server-side client with elevated privileges. Never expose to the browser. */
export function serviceClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL", url), required("SUPABASE_SERVICE_ROLE_KEY", serviceKey), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });
}

/** Anonymous client (read-only via RLS policies). Safe in the browser. */
export function anonClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL", url), required("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey), {
    global: { fetch: noStoreFetch },
  });
}
