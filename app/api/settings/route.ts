import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { getAppSettings } from "@/lib/settings";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings -- public (the login screen reads this before anyone
 *  is signed in) so keep this limited to settings that are safe for an
 *  anonymous visitor to see. */
export async function GET() {
  try {
    const db = serviceClient();
    const settings = await getAppSettings(db);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** PATCH /api/settings -- admin only. Body: { google_login_enabled }. */
export async function PATCH(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

    const body = await req.json() as { google_login_enabled?: boolean };
    if (typeof body.google_login_enabled !== "boolean") {
      return NextResponse.json({ error: "google_login_enabled must be a boolean." }, { status: 400 });
    }

    const { data, error } = await db
      .from("app_settings")
      .update({ google_login_enabled: body.google_login_enabled })
      .eq("id", 1)
      .select("google_login_enabled")
      .single();
    if (error) throw error;

    await logActivity(db, {
      userEmail: email,
      action: "settings_update",
      summary: `${body.google_login_enabled ? "Enabled" : "Disabled"} Google sign-in`,
      detail: { google_login_enabled: body.google_login_enabled },
    });
    return NextResponse.json({ settings: data });
  } catch (err) {
    // Supabase/PostgREST errors are plain objects, not Error instances --
    // `err instanceof Error ? err.message : String(err)` used to fall
    // through to String(err) for those and render as the useless
    // "[object Object]" (e.g. the admin's toggle failing with that text
    // whenever migration 45 hasn't been run against a deployment's
    // database yet, so the app_settings table doesn't exist).
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
