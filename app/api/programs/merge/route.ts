import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normField = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

async function mergeOne(
  db: ReturnType<typeof serviceClient>,
  sourceId: number,
  targetId: number,
): Promise<{ moved: number; merged: number; source_name: string | null; target_name: string | null }> {
  const { data: srcProg } = await db.from("programs").select("name").eq("id", sourceId).maybeSingle();
  const { data: tgtProg } = await db.from("programs").select("name").eq("id", targetId).maybeSingle();

  type Subj = { id: number; course_code: string; course_title: string };
  const { data: sourceSubjects, error: srcErr } = await db.from("subjects")
    .select("id, course_code, course_title").eq("program_id", sourceId);
  if (srcErr) throw srcErr;
  const { data: targetSubjects, error: tgtErr } = await db.from("subjects")
    .select("id, course_code, course_title").eq("program_id", targetId);
  if (tgtErr) throw tgtErr;

  const targetByKey = new Map<string, Subj>();
  for (const s of targetSubjects ?? []) {
    targetByKey.set(`${normField(s.course_code)}|${normField(s.course_title)}`, s);
  }

  let moved = 0;
  let merged = 0;

  for (const s of sourceSubjects ?? []) {
    const key = `${normField(s.course_code)}|${normField(s.course_title)}`;
    const dup = targetByKey.get(key);
    if (!dup) {
      const { error } = await db.from("subjects").update({ program_id: targetId }).eq("id", s.id);
      if (error) throw error;
      moved++;
      continue;
    }
    // Duplicate course under the target program -- combine assignments onto
    // the target's existing subject rather than leaving two rows.
    const { data: assigns, error: assignErr } = await db.from("assignments")
      .select("id").eq("subject_id", s.id);
    if (assignErr) throw assignErr;
    for (const a of assigns ?? []) {
      const { error: updErr } = await db.from("assignments").update({ subject_id: dup.id }).eq("id", a.id);
      if (updErr) {
        // Already assigned to the same title under dup -- drop the redundant row.
        await db.from("assignments").delete().eq("id", a.id);
      }
    }
    const { error: delSubjErr } = await db.from("subjects").delete().eq("id", s.id);
    if (delSubjErr) throw delSubjErr;
    merged++;
  }

  const { error: delProgErr } = await db.from("programs").delete().eq("id", sourceId);
  if (delProgErr) throw delProgErr;

  return { moved, merged, source_name: srcProg?.name ?? null, target_name: tgtProg?.name ?? null };
}

/** POST /api/programs/merge — combine one or more duplicate programs into
 *  one. Accepts either shape:
 *    { source_id, target_id }         -- single merge (Campus Validation)
 *    { keep_id, drop_ids: number[] }  -- bulk merge (Cleanup tab)
 *  Every subject under a source/drop program is moved to the target/keep
 *  program; if the target already has a subject with the same course code
 *  + title, the two are combined (assignments merged) instead of left as a
 *  duplicate course. Each emptied source program is deleted. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to merge programs." }, { status: 403 });
    }
    const body = await req.json() as { source_id?: number; target_id?: number; keep_id?: number; drop_ids?: number[] };
    const targetId = Number(body.target_id ?? body.keep_id);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "target_id (or keep_id) is required" }, { status: 400 });
    }
    const sourceIds = body.source_id != null
      ? [Number(body.source_id)]
      : (body.drop_ids ?? []).map(Number).filter((n) => Number.isFinite(n) && n !== targetId);
    if (!sourceIds.length) {
      return NextResponse.json({ error: "source_id (or drop_ids) is required" }, { status: 400 });
    }

    let totalMoved = 0;
    let totalMerged = 0;
    const summaries: string[] = [];
    for (const sourceId of sourceIds) {
      const { moved, merged, source_name, target_name } = await mergeOne(db, sourceId, targetId);
      totalMoved += moved;
      totalMerged += merged;
      summaries.push(`"${source_name ?? "?"}" into "${target_name ?? "?"}" (${moved} moved, ${merged} combined)`);
    }

    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "program_merge",
      summary: sourceIds.length === 1
        ? `Merged program ${summaries[0]}`
        : `Merged ${sourceIds.length} programs into one: ${summaries.join("; ")}`,
      detail: { source_ids: sourceIds, target_id: targetId, moved: totalMoved, merged: totalMerged },
    });
    return NextResponse.json({ ok: true, moved: totalMoved, merged: totalMerged });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
