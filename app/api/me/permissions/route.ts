import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/me/permissions -- the signed-in caller's own role and per-tab
 *  view/edit permissions. Requires sign-in (not in middleware's
 *  PUBLIC_API list), so there's no need to re-verify identity here beyond
 *  reading the email middleware already forwarded. */
export async function GET(req: Request) {
  try {
    const email = userEmailFromRequest(req);
    const db = serviceClient();
    const perms = await getUserPermissions(db, email);
    return NextResponse.json(perms);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
