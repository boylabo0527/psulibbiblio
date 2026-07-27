import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: Request, db: ReturnType<typeof serviceClient>) {
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin) throw new Error("Admin access required.");
  return email;
}

/** GET /api/admin/user-campuses -- every email's campus restriction, as
 *  { email: campus_id[] }. An email with no entry is unrestricted. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    await requireAdmin(req, db);
    const { data, error } = await db.from("user_campuses").select("email, campus_id");
    if (error) throw error;
    const byEmail: Record<string, number[]> = {};
    for (const row of data ?? []) {
      (byEmail[row.email] ??= []).push(row.campus_id);
    }
    return NextResponse.json({ user_campuses: byEmail });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}

/** PUT /api/admin/user-campuses -- replace the full campus scope for one
 *  user. Body: { email, campus_ids: number[] }. An empty campus_ids array
 *  means "unrestricted" (removes the restriction entirely, not "restricted
 *  to nothing"). */
export async function PUT(req: Request) {
  try {
    const db = serviceClient();
    const callerEmail = await requireAdmin(req, db);
    const body = await req.json() as { email?: string; campus_ids?: number[] };
    const email = (body.email ?? "").trim().toLowerCase();
    const campusIds = body.campus_ids ?? [];
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    const { error: delErr } = await db.from("user_campuses").delete().eq("email", email);
    if (delErr) throw delErr;
    if (campusIds.length) {
      const rows = campusIds.map((campus_id) => ({ email, campus_id }));
      const { error: insErr } = await db.from("user_campuses").insert(rows);
      if (insErr) throw insErr;
    }

    let campusNames: string[] = [];
    if (campusIds.length) {
      const { data: campusRows } = await db.from("campuses").select("id, name").in("id", campusIds);
      campusNames = (campusRows ?? []).map((c) => c.name);
    }
    await logActivity(db, {
      userEmail: callerEmail, action: "user_campus_scope_edit",
      summary: campusIds.length
        ? `Restricted ${email} to campus(es): ${campusNames.join(", ")}`
        : `Removed campus restriction for ${email} (now sees all campuses)`,
      detail: { email, campus_ids: campusIds },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 403 });
  }
}
