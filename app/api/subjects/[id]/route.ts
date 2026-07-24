import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/subjects/:id — update editable subject fields.
 *  Allowed fields: course_code, course_title, description, sort_order, locked, cost_per_title. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad subject id" }, { status: 400 });
    }
    const body = await req.json() as Record<string, unknown>;
    const allowed = ["course_code", "course_title", "description", "sort_order", "locked", "cost_per_title"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const db = serviceClient();
    const { data, error } = await db.from("subjects").update(patch).eq("id", id).select().single();
    if (error) throw error;

    const userEmail = userEmailFromRequest(req);
    if ("locked" in patch) {
      await logActivity(db, {
        userEmail, action: patch.locked ? "subject_lock" : "subject_unlock",
        summary: `${patch.locked ? "Locked" : "Unlocked"} course "${data.course_code || data.course_title}"${patch.locked ? " — Match runs will skip it" : ""}`,
        detail: { subject_id: id },
      });
    } else {
      await logActivity(db, {
        userEmail, action: "subject_edit",
        summary: `Edited course "${data.course_code || data.course_title}" (${Object.keys(patch).join(", ")})`,
        detail: { subject_id: id, fields: Object.keys(patch) },
      });
    }
    return NextResponse.json({ subject: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
