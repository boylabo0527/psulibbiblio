import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkRow = {
  program?: string; course_code?: string; title?: string;
  author?: string; publisher?: string; year?: string; isbn?: string; notes?: string;
};

/** POST /api/standard-titles/bulk -- the library committee's standard
 *  titles list, uploaded in bulk. Body: { rows: [{ program, course_code,
 *  title, author?, publisher?, year?, isbn?, notes? }, ...] }. Program +
 *  Course Code must exactly match an existing program/subject (case
 *  insensitive) -- this is an authoritative reference list, so a row that
 *  can't be resolved is reported back as an error rather than guessed at,
 *  the same way canvassing assignment always requires a human pick. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["standard-titles"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to upload standard titles." }, { status: 403 });
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
    inputs.forEach((r, i) => {
      const programName = (r.program ?? "").trim();
      const courseCode = (r.course_code ?? "").trim();
      if (!programName || !courseCode) {
        errors.push({ row: i + 1, reason: "Program and Course Code are required." });
        return;
      }
      const programId = programByName.get(programName.toLowerCase());
      if (programId == null) {
        errors.push({ row: i + 1, reason: `Program "${programName}" not found.` });
        return;
      }
      const subjectId = subjectByKey.get(`${programId}::${courseCode.toLowerCase()}`);
      if (subjectId == null) {
        errors.push({ row: i + 1, reason: `Course code "${courseCode}" not found under "${programName}".` });
        return;
      }
      insertRows.push({
        subject_id: subjectId, title: (r.title ?? "").trim(), author: (r.author ?? "").trim(),
        publisher: (r.publisher ?? "").trim(), year: (r.year ?? "").trim(), isbn: (r.isbn ?? "").trim(),
        notes: (r.notes ?? "").trim(), created_by: email,
      });
    });

    if (insertRows.length) {
      const { error } = await db.from("standard_titles").insert(insertRows);
      if (error) throw error;
    }

    await logActivity(db, {
      userEmail: email, action: "standard_title_bulk_upload",
      summary: `${email} uploaded ${insertRows.length} standard title(s)${errors.length ? `, ${errors.length} row(s) skipped` : ""}`,
      detail: { inserted: insertRows.length, error_count: errors.length },
    });
    return NextResponse.json({ ok: true, inserted: insertRows.length, errors });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
