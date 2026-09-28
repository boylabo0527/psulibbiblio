import type { SupabaseClient } from "@supabase/supabase-js";

export type AppSettings = {
  google_login_enabled: boolean;
};

const DEFAULTS: AppSettings = { google_login_enabled: true };

/** Reads the single app_settings row, falling back to defaults if the row
 *  (or the table, on a database that hasn't run migration 45 yet) is missing
 *  -- callers should never fail outright over a settings lookup. */
export async function getAppSettings(db: SupabaseClient): Promise<AppSettings> {
  const { data } = await db.from("app_settings").select("google_login_enabled").eq("id", 1).maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) };
}
