import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normField = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** POST /api/programs/merge — combine two duplicate programs into one.
 *  Body: { source_id, target_id }. Every subject under source_id is moved to
 *  target_id; if target_id already has a subject with the same course code
 *  + title, the two subjects are merged (assignments combined) instead of
 *  left as a duplicate course. source_id is deleted once empty. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to merge programs." }, { status: 403 });
    }
    const body = await req.json() as { source_id?: number; target_id?: number };
    const sourceId = body.source_id;
    const targetId = body.target_id;
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
      return NextResponse.json({ error: "source_id and target_id are required" }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "source_id and target_id must differ" }, { status: 400 });
    }

    const { data: srcProg } = await db.from("programs").select("name").eq("id", sourceId as number).maybeSingle();
    const { data: tgtProg } = await db.from("programs").select("name").eq("id", targetId as number).maybeSingle();

    type Subj = { id: number; course_code: string; course_title: string };
    const { data: sourceSubjects, error: srcErr } = await db.from("subjects")
      .select("id, course_code, course_title").eq("program_id", sourceId as number);
    if (srcErr) throw srcErr;
    const { data: targetSubjects, error: tgtErr } = await db.from("subjects")
      .select("id, course_code, course_title").eq("program_id", targetId as number);
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
      // Duplicate course under the target program — combine assignments onto
      // the target's existing subject rather than leaving two rows.
      const { data: assigns, error: assignErr } = await db.from("assignments")
        .select("id").eq("subject_id", s.id);
      if (assignErr) throw assignErr;
      for (const a of assigns ?? []) {
        const { error: updErr } = await db.from("assignments").update({ subject_id: dup.id }).eq("id", a.id);
        if (updErr) {
          // Already assigned to the same title under dup — drop the redundant row.
          await db.from("assignments").delete().eq("id", a.id);
        }
      }
      const { error: delSubjErr } = await db.from("subjects").delete().eq("id", s.id);
      if (delSubjErr) throw delSubjErr;
      merged++;
    }

    const { error: delProgErr } = await db.from("programs").delete().eq("id", sourceId as number);
    if (delProgErr) throw delProgErr;

    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "program_merge",
      summary: `Merged program "${srcProg?.name ?? "?"}" into "${tgtProg?.name ?? "?"}" (${moved} subject${moved === 1 ? "" : "s"} moved, ${merged} combined)`,
      detail: { source_id: sourceId, target_id: targetId, moved, merged },
    });
    return NextResponse.json({ ok: true, moved, merged });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
