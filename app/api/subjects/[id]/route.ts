import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/subjects/:id — update editable subject fields.
 *  Allowed fields: course_code, course_title, description, sort_order, locked, cost_per_title.
 *
 *  course_code/course_title/description/sort_order are sent from BOTH
 *  Programs & Export and Campus Validation's UI, so a caller must declare
 *  which one it's acting as via `_tab` -- checking "does the user have
 *  edit rights on programs OR campus-validation" would let a role with
 *  edit rights on the OTHER tab bypass a restriction specifically placed
 *  on this one, which is exactly the bug this replaced. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad subject id" }, { status: 400 });
    }
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    const body = await req.json() as Record<string, unknown>;
    const allowed = ["course_code", "course_title", "description", "sort_order", "locked", "cost_per_title"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    if ("cost_per_title" in patch && !perms.isAdmin && !perms.tabs["procurement"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to set cost estimates." }, { status: 403 });
    }
    if ("locked" in patch && !perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to lock/unlock courses." }, { status: 403 });
    }
    const otherFields = Object.keys(patch).some((k) => !["cost_per_title", "locked"].includes(k));
    if (otherFields) {
      const sourceTab = body["_tab"] === "campus-validation" ? "campus-validation" : "programs";
      if (!perms.isAdmin && !perms.tabs[sourceTab]?.can_edit) {
        return NextResponse.json({ error: "Your account doesn't have permission to edit courses." }, { status: 403 });
      }
    }

    if (perms.campusIds !== null) {
      const { data: subj } = await db.from("subjects").select("program_id").eq("id", id).maybeSingle();
      const allowedProgramIds = await getAllowedProgramIds(db, perms.campusIds);
      if (!subj || !allowedProgramIds.has(subj.program_id)) {
        return NextResponse.json({ error: "This course isn't in one of your assigned campuses." }, { status: 403 });
      }
    }

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
