import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/title-recommendations/:id -- either a status change
 *  (pending/sourced/declined), which is a canvassing-staff decision, or an
 *  edit to the recommendation's own content (title/author/etc.), which
 *  only the original submitter can do and only while it's still pending
 *  (once staff has acted on it, editing out from under them would be
 *  confusing). Body: { status } or { title, author?, publisher?, year?,
 *  isbn?, format_preference?, notes? }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad recommendation id" }, { status: 400 });

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);

    const { data: rec, error: recErr } = await db.from("title_recommendations").select("id, recommended_by, title, status").eq("id", id).maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });

    const body = await req.json() as {
      status?: string; title?: string; author?: string; publisher?: string;
      year?: string; isbn?: string; format_preference?: string; notes?: string;
    };

    if (body.status !== undefined) {
      const isReviewer = perms.isAdmin || !!perms.tabs["canvassing"]?.can_edit;
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

    const { data: rec, error: recErr } = await db.from("title_recommendations").select("id, recommended_by, title, status").eq("id", id).maybeSingle();
    if (recErr) throw recErr;
    if (!rec) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });

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
