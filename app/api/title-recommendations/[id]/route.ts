import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/title-recommendations/:id -- a status change or course
 *  reassignment (both a canvassing-staff decision), or an edit to the
 *  recommendation's own content (title/author/etc.), which only the
 *  original submitter can do and only while it's still pending (once staff
 *  has acted on it, editing out from under them would be confusing).
 *  Body: { status } or { subject_id } or { title, author?, publisher?,
 *  year?, isbn?, format_preference?, notes?, price_estimate? }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad recommendation id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);

    const { data: rec, error: recErr } = await db.from("title_recommendations").select("id, recommended_by, title, status, subjects(program_id)").eq("id", id).maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    const recProgramId = (rec.subjects as unknown as { program_id?: number } | null)?.program_id ?? null;
    if (!(await isProgramInScope(db, perms, recProgramId))) {
      return NextResponse.json({ error: "This recommendation isn't in your assigned campus(es)." }, { status: 403 });
    }

    const body = await req.json() as {
      status?: string; subject_id?: number; title?: string; author?: string; publisher?: string;
      year?: string; isbn?: string; format_preference?: string; notes?: string; price_estimate?: number | null;
    };
    const isReviewer = perms.isAdmin || !!perms.tabs["canvassing"]?.can_edit;

    if (body.status !== undefined) {
      if (!isReviewer) {
        return NextResponse.json({ error: "Only Market Canvassing staff can change a recommendation's status." }, { status: 403 });
      }
      if (!["pending", "sourced", "declined"].includes(body.status)) {
        return NextResponse.json({ error: "status must be pending, sourced, or declined." }, { status: 400 });
      }
      const { error } = await db.from("title_recommendations").update({ status: body.status }).eq("id", id);
      if (error) throw error;
      await logActivity(db, {
        userEmail: email, action: "title_recommendation_status",
        summary: `${email} marked recommendation "${rec.title}" as ${body.status}`,
        detail: { recommendation_id: id, status: body.status },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.subject_id !== undefined) {
      if (!isReviewer) {
        return NextResponse.json({ error: "Only Market Canvassing staff can reassign a recommendation to a different course." }, { status: 403 });
      }
      const newSubjectId = Number(body.subject_id);
      if (!Number.isFinite(newSubjectId)) return NextResponse.json({ error: "subject_id is required." }, { status: 400 });
      const { data: newSubject } = await db.from("subjects").select("id, course_code, course_title, program_id").eq("id", newSubjectId).maybeSingle();
      if (!newSubject) return NextResponse.json({ error: "Course not found." }, { status: 404 });
      if (!(await isProgramInScope(db, perms, newSubject.program_id))) {
        return NextResponse.json({ error: "That course isn't in your assigned campus(es)." }, { status: 403 });
      }
      const { error } = await db.from("title_recommendations").update({ subject_id: newSubjectId }).eq("id", id);
      if (error) throw error;
      await logActivity(db, {
        userEmail: email, action: "title_recommendation_reassign",
        summary: `${email} reassigned recommendation "${rec.title}" to ${[newSubject.course_code, newSubject.course_title].filter(Boolean).join(" — ")}`,
        detail: { recommendation_id: id, subject_id: newSubjectId },
      });
      return NextResponse.json({ ok: true });
    }

    const isOwner = rec.recommended_by === email;
    if (!isOwner || rec.status !== "pending") {
      return NextResponse.json({ error: "Only the original submitter can edit a recommendation, and only while it's still pending." }, { status: 403 });
    }
    const update: Record<string, unknown> = {};
    if (body.title !== undefined) update.title = body.title.trim();
    if (body.author !== undefined) update.author = body.author.trim();
    if (body.publisher !== undefined) update.publisher = body.publisher.trim();
    if (body.year !== undefined) update.year = body.year.trim();
    if (body.isbn !== undefined) update.isbn = body.isbn.trim();
    if (body.format_preference !== undefined) update.format_preference = body.format_preference.trim();
    if (body.notes !== undefined) update.notes = body.notes.trim();
    if (body.price_estimate !== undefined) update.price_estimate = Number.isFinite(body.price_estimate) ? body.price_estimate : null;
    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

    const { error } = await db.from("title_recommendations").update(update).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** DELETE /api/title-recommendations/:id -- the original submitter can
 *  withdraw their own still-pending recommendation; canvassing staff/admin
 *  can remove any of them (e.g. duplicates). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad recommendation id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);

    const { data: rec, error: recErr } = await db.from("title_recommendations").select("id, recommended_by, title, status, subjects(program_id)").eq("id", id).maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    const recProgramId = (rec.subjects as unknown as { program_id?: number } | null)?.program_id ?? null;
    if (!(await isProgramInScope(db, perms, recProgramId))) {
      return NextResponse.json({ error: "This recommendation isn't in your assigned campus(es)." }, { status: 403 });
    }

    const isReviewer = perms.isAdmin || !!perms.tabs["canvassing"]?.can_edit;
    const isOwnerPending = rec.recommended_by === email && rec.status === "pending";
    if (!isReviewer && !isOwnerPending) {
      return NextResponse.json({ error: "You can only remove your own recommendation while it's still pending." }, { status: 403 });
    }

    const { error } = await db.from("title_recommendations").delete().eq("id", id);
    if (error) throw error;
    await logActivity(db, {
      userEmail: email, action: "title_recommendation_delete",
      summary: `${email} removed recommendation "${rec.title}"`,
      detail: { recommendation_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
