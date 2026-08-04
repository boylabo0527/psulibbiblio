import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change canvassing assignments." }, { status: 403 });
    }
    const { id, subject_id, program_id } = await req.json();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const { error } = await db.from("canvassing")
      .update({ subject_id: subject_id ?? null, program_id: program_id ?? null })
      .eq("id", Number(id));
    if (error) throw error;

    // Reassigning the primary course resets which courses this title counts
    // toward -- any additional courses linked via /link-subject were tied to
    // the old assignment and shouldn't silently keep counting after a fix.
    await db.from("canvassing_subjects").delete().eq("canvassing_id", Number(id));
    if (subject_id) {
      await db.from("canvassing_subjects").insert({ canvassing_id: Number(id), subject_id: Number(subject_id) });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
