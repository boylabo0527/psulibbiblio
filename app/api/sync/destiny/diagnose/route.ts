import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { destinyEnabled, diagnoseDestinyConnection } from "@/lib/destiny";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sync/destiny/diagnose -- admin-only troubleshooting helper for
 *  when "Sync now" fails with a SQL Server error that's ambiguous from the
 *  message alone (see diagnoseDestinyConnection in lib/destiny.ts). Runs
 *  entirely through the browser so there's no need to install a separate
 *  SQL Server client just to see what the configured account can access. */
export async function GET(req: Request) {
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmailFromRequest(req));
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run this." }, { status: 403 });
  }
  if (!destinyEnabled()) {
    return NextResponse.json({
      error: "Destiny sync isn't configured yet -- set DESTINY_DB_HOST, DESTINY_DB_NAME, DESTINY_DB_USER, and DESTINY_DB_PASSWORD in Vercel's project settings.",
    }, { status: 400 });
  }
  try {
    const diagnostics = await diagnoseDestinyConnection();
    return NextResponse.json({ diagnostics });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
