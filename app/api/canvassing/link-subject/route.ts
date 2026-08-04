import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/canvassing/link-subject -- credit an already-assigned canvassed
 *  title toward an additional course, on top of its primary subject_id (e.g.
 *  a general-education ebook relevant to three subjects instead of just the
 *  one it was originally canvassed for). Body: { canvassing_id, subject_id }.
 *  The title stays a single canvassing row / single purchase line item --
 *  this only affects which subjects' compliance gap and "still needs
 *  procurement" it counts against. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change canvassing assignments." }, { status: 403 });
    }
    const body = await req.json() as { canvassing_id?: number; subject_id?: number };
    const canvassingId = Number(body.canvassing_id);
    const subjectId = Number(body.subject_id);
    if (!Number.isFinite(canvassingId) || !Number.isFinite(subjectId)) {
      return NextResponse.json({ error: "canvassing_id and subject_id are required." }, { status: 400 });
    }

    const { data: entry } = await db.from("canvassing").select("id, title, subject_id").eq("id", canvassingId).maybeSingle();
    if (!entry) return NextResponse.json({ error: "Canvassing entry not found." }, { status: 404 });
    if (!entry.subject_id) {
      return NextResponse.json({ error: "Assign this title to a primary course first." }, { status: 400 });
    }

    const { data: subject } = await db.from("subjects").select("course_code, course_title").eq("id", subjectId).maybeSingle();
    if (!subject) return NextResponse.json({ error: "Course not found." }, { status: 404 });

    const { error } = await db.from("canvassing_subjects")
      .insert({ canvassing_id: canvassingId, subject_id: subjectId });
    if (error && error.code !== "23505") throw error;

    await logActivity(db, {
      userEmail: email, action: "canvassing_link_subject",
      summary: `${email} linked "${entry.title}" to ${[subject.course_code, subject.course_title].filter(Boolean).join(" — ")}`,
      detail: { canvassing_id: canvassingId, subject_id: subjectId },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}

/** DELETE /api/canvassing/link-subject?canvassing_id=..&subject_id=.. --
 *  remove an additional link. The primary subject_id can't be removed this
 *  way -- reassign it via /api/canvassing/assign instead, which keeps
 *  "the canvassing row's course" and "does it count toward this course"
 *  from disagreeing with each other. */
export async function DELETE(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change canvassing assignments." }, { status: 403 });
    }
    const u = new URL(req.url);
    const canvassingId = Number(u.searchParams.get("canvassing_id"));
    const subjectId = Number(u.searchParams.get("subject_id"));
    if (!Number.isFinite(canvassingId) || !Number.isFinite(subjectId)) {
      return NextResponse.json({ error: "canvassing_id and subject_id are required." }, { status: 400 });
    }

    const { data: entry } = await db.from("canvassing").select("subject_id").eq("id", canvassingId).maybeSingle();
    if (entry?.subject_id === subjectId) {
      return NextResponse.json({ error: "Can't unlink the primary course -- reassign it instead." }, { status: 400 });
    }

    const { error } = await db.from("canvassing_subjects").delete()
      .eq("canvassing_id", canvassingId).eq("subject_id", subjectId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
