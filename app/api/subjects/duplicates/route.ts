import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { normalizeForDedup } from "@/lib/dedup";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DuplicateSubjectRow = {
  id: number;
  course_code: string;
  course_title: string;
  total_assignments: number;
  locked_assignments: number;
};

export type DuplicateSubjectGroup = {
  program_id: number;
  program: string;
  key: string;
  subjects: DuplicateSubjectRow[];
};

/** GET /api/subjects/duplicates -- admin-only. Two courses in the same
 *  program with the same course code (or, less urgently, the same title
 *  under different codes) are a real bug, not just clutter: the Validate
 *  Matches CSV workflow and the Programs & Export CSV both key a course by
 *  its code -- re-uploading a review keys off `course_code`, and when two
 *  subjects in one program share a code, that lookup collapses to
 *  whichever one the Map saw last, silently dropping the other from
 *  review. `codeGroups` (same program + same code, case/whitespace
 *  insensitive) is that bug; `titleGroups` (same program + same title,
 *  different codes) is milder -- Match still keys by subject_id so it's
 *  not silently broken, but it's still confusing for review and usually a
 *  data-entry accident -- so it's reported separately. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    type SubjectRec = { id: number; program_id: number; course_code: string | null; course_title: string };
    const subjects = await pageThrough<SubjectRec>((from, to) =>
      db.from("subjects")
        .select("id, program_id, course_code, course_title")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>,
    );
    if (!subjects.length) return NextResponse.json({ codeGroups: [], titleGroups: [] });

    const programIds = Array.from(new Set(subjects.map((s) => s.program_id)));
    const { data: programRows } = await db.from("programs").select("id, name").in("id", programIds);
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    // Only care about counts for subjects that turn out to be in a
    // duplicate group -- narrow the assignments query to those ids instead
    // of every assignment in the database.
    const byCode = new Map<string, SubjectRec[]>();
    const byTitle = new Map<string, SubjectRec[]>();
    for (const s of subjects) {
      const code = (s.course_code ?? "").trim().toLowerCase();
      if (code) {
        const key = `${s.program_id}|${code}`;
        if (!byCode.has(key)) byCode.set(key, []);
        byCode.get(key)!.push(s);
      }
      const title = normalizeForDedup(s.course_title);
      if (title) {
        const key = `${s.program_id}|${title}`;
        if (!byTitle.has(key)) byTitle.set(key, []);
        byTitle.get(key)!.push(s);
      }
    }

    const codeEntries = Array.from(byCode.entries()).filter(([, list]) => list.length > 1);
    // A code-duplicate group's subjects almost always share the same title
    // too -- reporting them again under titleGroups would just be noise, so
    // titleGroups only covers groups that aren't already flagged by code.
    const codeGroupedIds = new Set(codeEntries.flatMap(([, list]) => list.map((s) => s.id)));
    const titleEntries = Array.from(byTitle.entries())
      .filter(([, list]) => list.length > 1 && list.some((s) => !codeGroupedIds.has(s.id)));

    const dupIds = Array.from(new Set([
      ...codeEntries.flatMap(([, list]) => list.map((s) => s.id)),
      ...titleEntries.flatMap(([, list]) => list.map((s) => s.id)),
    ]));

    const countsById = new Map<number, { total: number; locked: number }>();
    if (dupIds.length) {
      type AssignRow = { subject_id: number; manual: number };
      const assignments: AssignRow[] = [];
      for (let i = 0; i < dupIds.length; i += 200) {
        const chunk = dupIds.slice(i, i + 200);
        const rows = await pageThrough<AssignRow>((from, to) =>
          db.from("assignments")
            .select("subject_id, manual")
            .in("subject_id", chunk)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
        );
        assignments.push(...rows);
      }
      for (const a of assignments) {
        if (!countsById.has(a.subject_id)) countsById.set(a.subject_id, { total: 0, locked: 0 });
        const c = countsById.get(a.subject_id)!;
        c.total++;
        if (a.manual) c.locked++;
      }
    }

    function toRow(s: SubjectRec): DuplicateSubjectRow {
      const c = countsById.get(s.id) ?? { total: 0, locked: 0 };
      return {
        id: s.id, course_code: s.course_code ?? "", course_title: s.course_title,
        total_assignments: c.total, locked_assignments: c.locked,
      };
    }
    function toGroup([key, list]: [string, SubjectRec[]]): DuplicateSubjectGroup {
      const pid = list[0].program_id;
      return {
        program_id: pid, program: programMap.get(pid) ?? "", key,
        subjects: list.map(toRow).sort((a, b) => b.total_assignments - a.total_assignments || a.id - b.id),
      };
    }

    const codeGroups = codeEntries.map(toGroup)
      .sort((a, b) => a.program.localeCompare(b.program) || a.key.localeCompare(b.key));
    const titleGroups = titleEntries.map(toGroup)
      .sort((a, b) => a.program.localeCompare(b.program) || a.key.localeCompare(b.key));

    return NextResponse.json({ codeGroups, titleGroups });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
