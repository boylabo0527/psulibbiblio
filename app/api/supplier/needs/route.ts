import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { ACCREDITATION_MIN, RECENCY_YEARS } from "@/lib/compliance";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SupplierNeedRow = {
  program: string;
  course_code: string;
  course_title: string;
  current_printed: number;
  current_digital: number;
  gap: number; // additional titles (any format) still needed for accreditation
};

/** GET /api/supplier/needs -- read-only, no cost figures: which subjects
 *  need more titles, and the current printed/digital mix, so a supplier
 *  can see what to offer without seeing internal budget numbers. Requires
 *  the caller's role to have view access to the "supplier-view" tab (or
 *  be an admin). */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["supplier-view"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this view." }, { status: 403 });
    }

    const yearCutoff = new Date().getFullYear() - RECENCY_YEARS;

    type SubjectRec = { id: number; program_id: number; course_code: string; course_title: string };
    const subjects = await pageThrough<SubjectRec>(
      (from, to) => db.from("subjects")
        .select("id, program_id, course_code, course_title")
        .range(from, to) as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>,
    );
    if (!subjects.length) return NextResponse.json({ rows: [] });

    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    type AssignRow = { subject_id: number; titles: { format: string; year: string | null } | null };
    const subjectIds = subjects.map((s) => s.id);
    const assignments: AssignRow[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      const rows = await pageThrough<AssignRow>(
        (from, to) => db.from("assignments")
          .select("subject_id, titles(format, year)")
          .in("subject_id", chunk)
          .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }

    const printedMap = new Map<number, number>();
    const digitalMap = new Map<number, number>();
    const recentMap = new Map<number, number>();
    for (const a of assignments) {
      const t = a.titles;
      if (!t) continue;
      const isPrint = t.format === "book_printed" || t.format === "journal_printed";
      if (isPrint) printedMap.set(a.subject_id, (printedMap.get(a.subject_id) ?? 0) + 1);
      else digitalMap.set(a.subject_id, (digitalMap.get(a.subject_id) ?? 0) + 1);

      const y = parseInt(t.year ?? "", 10);
      if (!isNaN(y) && y >= yearCutoff) recentMap.set(a.subject_id, (recentMap.get(a.subject_id) ?? 0) + 1);
    }

    const rows: SupplierNeedRow[] = subjects
      .map((s) => {
        const recent = recentMap.get(s.id) ?? 0;
        const gap = Math.max(0, ACCREDITATION_MIN - recent);
        return {
          program: programMap.get(s.program_id) ?? "",
          course_code: s.course_code,
          course_title: s.course_title,
          current_printed: printedMap.get(s.id) ?? 0,
          current_digital: digitalMap.get(s.id) ?? 0,
          gap,
        };
      })
      .filter((r) => r.gap > 0)
      .sort((a, b) => b.gap - a.gap);

    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
