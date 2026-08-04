import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type TitleRecommendationRow = {
  id: number;
  subject_id: number;
  subject_label: string;
  program: string;
  recommended_by: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  isbn: string;
  format_preference: string;
  notes: string;
  status: "pending" | "sourced" | "declined";
  created_at: string;
};

/** Anyone who does canvassing (or is admin) counts as a "reviewer" here --
 *  they need to see recommendations as sourcing guidance even if an admin
 *  never separately granted them the faculty-recommendations tab itself. */
function isReviewer(perms: Awaited<ReturnType<typeof getUserPermissions>>): boolean {
  return perms.isAdmin || !!perms.tabs["canvassing"]?.can_view;
}

/** GET /api/title-recommendations -- every recommendation, newest first.
 *  Viewable by anyone with faculty-recommendations or canvassing view
 *  access (or admin) -- faculty should be able to see what's already been
 *  suggested (avoids duplicate submissions) as much as staff need it for
 *  sourcing. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["faculty-recommendations"]?.can_view && !isReviewer(perms)) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const { data, error } = await db.from("title_recommendations")
      .select("*, subjects(course_code, course_title, program_id)")
      .order("created_at", { ascending: false });
    if (error) throw error;

    const programIds = Array.from(new Set((data ?? [])
      .map((r) => (r.subjects as unknown as { program_id?: number } | null)?.program_id)
      .filter((id): id is number => id != null)));
    const programNameById = new Map<number, string>();
    if (programIds.length) {
      const { data: progs } = await db.from("programs").select("id, name").in("id", programIds);
      for (const p of progs ?? []) programNameById.set(p.id, p.name);
    }

    const rows: TitleRecommendationRow[] = (data ?? []).map((r) => {
      const sub = r.subjects as unknown as { course_code?: string; course_title?: string; program_id?: number } | null;
      return {
        id: r.id, subject_id: r.subject_id,
        subject_label: sub ? [sub.course_code, sub.course_title].filter(Boolean).join(" — ") : "",
        program: sub?.program_id != null ? programNameById.get(sub.program_id) ?? "" : "",
        recommended_by: r.recommended_by, title: r.title, author: r.author, publisher: r.publisher,
        year: r.year, isbn: r.isbn, format_preference: r.format_preference, notes: r.notes,
        status: r.status, created_at: r.created_at,
      };
    });
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

type TitleInput = { title?: string; author?: string; publisher?: string; year?: string; isbn?: string; format_preference?: string; notes?: string };

/** POST /api/title-recommendations -- a faculty member (or admin) suggests
 *  one or more titles for a single subject in one submission (e.g.
 *  recommending 3 books for a course at once). Body: { subject_id,
 *  titles: [{ title, author?, publisher?, year?, isbn?, format_preference?,
 *  notes? }, ...] }. A single-title recommendation is just a `titles`
 *  array of length 1 -- there's no separate single-item shape to keep in
 *  sync (same reasoning as POST /api/supplier/offers). */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["faculty-recommendations"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to submit recommendations." }, { status: 403 });
    }

    const body = await req.json() as { subject_id?: number; titles?: TitleInput[] };
    const subjectId = body.subject_id;
    const inputs = (body.titles ?? []).filter((t) => (t.title ?? "").trim());
    if (!Number.isFinite(subjectId) || !inputs.length) {
      return NextResponse.json({ error: "subject_id and at least one title are required." }, { status: 400 });
    }

    const insertRows = inputs.map((t) => ({
      subject_id: subjectId, recommended_by: email, title: (t.title ?? "").trim(),
      author: (t.author ?? "").trim(), publisher: (t.publisher ?? "").trim(),
      year: (t.year ?? "").trim(), isbn: (t.isbn ?? "").trim(),
      format_preference: (t.format_preference ?? "").trim(), notes: (t.notes ?? "").trim(),
    }));

    const { data, error } = await db.from("title_recommendations").insert(insertRows).select("id");
    if (error) throw error;

    await logActivity(db, {
      userEmail: email, action: "title_recommendation_submit",
      summary: inputs.length === 1
        ? `${email} recommended "${insertRows[0].title}"`
        : `${email} recommended ${inputs.length} titles: ${inputs.map((t) => `"${t.title}"`).join(", ")}`,
      detail: { recommendation_ids: (data ?? []).map((d) => d.id), subject_id: subjectId },
    });
    return NextResponse.json({ ok: true, ids: (data ?? []).map((d) => d.id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
