import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 25;

/** POST /api/canvassing/mass-validate -- body { items: { id, subject_id }[] }.
 *  Confirms a canvassing row's course assignment (setting subject_id and
 *  program_id, same as /api/canvassing/assign) AND marks it validated in
 *  one step, so a canvassing row only becomes Purchase-Request-eligible
 *  once a librarian has reviewed it -- not the moment an auto-suggested
 *  match is saved. Two callers:
 *  - The in-app "Mass Validate" bulk action (CanvassingTab): each item's
 *    subject_id is the row's own current assignment, i.e. "approve the
 *    proposal as-is."
 *  - The download/upload validation round-trip: subject_id comes from the
 *    "Proposed Subject ID" column of an uploaded, reviewed spreadsheet,
 *    so a row can be assigned AND validated in the same pass even if it
 *    was still unassigned when exported. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change canvassing assignments." }, { status: 403 });
    }
    const body = await req.json() as { items?: { id?: number; subject_id?: number }[] };
    const items = (body.items ?? [])
      .map((i) => ({ id: Number(i.id), subject_id: Number(i.subject_id) }))
      .filter((i) => Number.isFinite(i.id) && Number.isFinite(i.subject_id) && i.subject_id > 0);
    if (!items.length) {
      return NextResponse.json({ error: "items array with id/subject_id pairs is required." }, { status: 400 });
    }

    const ids = items.map((i) => i.id);
    const subjectIds = Array.from(new Set(items.map((i) => i.subject_id)));
    const [{ data: existingRows }, { data: subjectRows }] = await Promise.all([
      db.from("canvassing").select("id, title, program_id").in("id", ids),
      db.from("subjects").select("id, course_code, course_title, program_id").in("id", subjectIds),
    ]);
    const existingById = new Map((existingRows ?? []).map((r) => [r.id as number, r]));
    const subjectById = new Map((subjectRows ?? []).map((s) => [s.id as number, s]));

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;
    const inScope = (programId: number | null) => allowedProgramIds === null || programId == null || allowedProgramIds.has(programId);

    const skipped: { id: number; reason: string }[] = [];
    const toApply: { id: number; title: string; subject_id: number; program_id: number; course_label: string }[] = [];
    for (const item of items) {
      const existing = existingById.get(item.id);
      if (!existing) { skipped.push({ id: item.id, reason: "Canvassing entry not found." }); continue; }
      const subject = subjectById.get(item.subject_id);
      if (!subject) { skipped.push({ id: item.id, reason: "Proposed course not found." }); continue; }
      if (!inScope(existing.program_id as number | null) || !inScope(subject.program_id as number | null)) {
        skipped.push({ id: item.id, reason: "Not in your assigned campus(es)." }); continue;
      }
      toApply.push({
        id: item.id, title: existing.title as string,
        subject_id: item.subject_id, program_id: subject.program_id as number,
        course_label: [subject.course_code, subject.course_title].filter(Boolean).join(" — "),
      });
    }

    for (let i = 0; i < toApply.length; i += BATCH) {
      const chunk = toApply.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (r) => {
        const { error } = await db.from("canvassing")
          .update({ subject_id: r.subject_id, program_id: r.program_id, validated: true })
          .eq("id", r.id);
        if (error) throw error;
        // Reassigning the primary course resets which additional courses
        // this title counts toward -- same rationale as /api/canvassing/assign.
        await db.from("canvassing_subjects").delete().eq("canvassing_id", r.id);
        await db.from("canvassing_subjects").insert({ canvassing_id: r.id, subject_id: r.subject_id });
      }));
    }

    if (toApply.length) {
      await logActivity(db, {
        userEmail: email, action: "canvassing_mass_validate",
        summary: `${email} validated ${toApply.length} canvassing ${toApply.length === 1 ? "entry" : "entries"}${skipped.length ? ` (${skipped.length} skipped)` : ""}`,
        detail: { ids: toApply.map((r) => r.id), skipped },
      });
    }

    return NextResponse.json({ validated: toApply.length, skipped });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
