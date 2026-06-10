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

/** Server-side client with elevated privileges. Never expose to the browser. */
export function serviceClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL", url), required("SUPABASE_SERVICE_ROLE_KEY", serviceKey), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anonymous client (read-only via RLS policies). Safe in the browser. */
export function anonClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL", url), required("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey));
}
