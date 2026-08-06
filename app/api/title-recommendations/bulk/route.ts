import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkRow = {
  program?: string; course_code?: string; title?: string; author?: string; publisher?: string;
  year?: string; isbn?: string; format_preference?: string; notes?: string; price_estimate?: number | string;
};

/** POST /api/title-recommendations/bulk -- a faculty member recommends
 *  titles for several courses in one file upload, instead of being limited
 *  to one course per submission (see POST /api/title-recommendations for
 *  that single-course flow, still used by the manual entry form). Body:
 *  { rows: [{ program, course_code, title, author?, publisher?, year?,
 *  isbn?, format_preference?, notes?, price_estimate? }, ...] }. Program +
 *  Course Code must exactly match an existing program/subject (case
 *  insensitive), same as Standard Titles' bulk upload -- a row that can't
 *  be resolved is reported back rather than guessed at. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["faculty-recommendations"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to submit recommendations." }, { status: 403 });
    }

    const body = await req.json() as { rows?: BulkRow[] };
    const inputs = (body.rows ?? []).filter((r) => (r.title ?? "").trim());
    if (!inputs.length) return NextResponse.json({ error: "No rows with a title were found." }, { status: 400 });

    const { data: programs } = await db.from("programs").select("id, name");
    const { data: subjects } = await db.from("subjects").select("id, program_id, course_code");
    const programByName = new Map((programs ?? []).map((p) => [p.name.trim().toLowerCase(), p.id as number]));
    const subjectByKey = new Map((subjects ?? []).map((s) => [`${s.program_id}::${(s.course_code ?? "").trim().toLowerCase()}`, s.id as number]));

    const insertRows: Record<string, unknown>[] = [];
    const errors: { row: number; reason: string }[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const r = inputs[i];
      const programName = (r.program ?? "").trim();
      const courseCode = (r.course_code ?? "").trim();
      if (!programName || !courseCode) {
        errors.push({ row: i + 1, reason: "Program and Course Code are required." });
        continue;
      }
      const programId = programByName.get(programName.toLowerCase());
      if (programId == null) {
        errors.push({ row: i + 1, reason: `Program "${programName}" not found.` });
        continue;
      }
      const subjectId = subjectByKey.get(`${programId}::${courseCode.toLowerCase()}`);
      if (subjectId == null) {
        errors.push({ row: i + 1, reason: `Course code "${courseCode}" not found under "${programName}".` });
        continue;
      }
      if (!(await isProgramInScope(db, perms, programId))) {
        errors.push({ row: i + 1, reason: `"${programName}" isn't in your assigned campus(es).` });
        continue;
      }
      const priceEstimate = Number(r.price_estimate);
      insertRows.push({
        subject_id: subjectId, recommended_by: email, title: (r.title ?? "").trim(),
        author: (r.author ?? "").trim(), publisher: (r.publisher ?? "").trim(),
        year: (r.year ?? "").trim(), isbn: (r.isbn ?? "").trim(),
        format_preference: (r.format_preference ?? "").trim(), notes: (r.notes ?? "").trim(),
        price_estimate: Number.isFinite(priceEstimate) && r.price_estimate !== "" && r.price_estimate != null ? priceEstimate : null,
      });
    }

    if (insertRows.length) {
      const { error } = await db.from("title_recommendations").insert(insertRows);
      if (error) throw error;
    }

    await logActivity(db, {
      userEmail: email, action: "title_recommendation_bulk_upload",
      summary: `${email} uploaded ${insertRows.length} title recommendation(s)${errors.length ? `, ${errors.length} row(s) skipped` : ""}`,
      detail: { inserted: insertRows.length, error_count: errors.length },
    });
    return NextResponse.json({ ok: true, inserted: insertRows.length, errors });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
