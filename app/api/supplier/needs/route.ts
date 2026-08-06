import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { RECENCY_YEARS, countsTowardBookCompliance, isPrintedBook, evaluateBookCompliance } from "@/lib/compliance";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SupplierNeedRow = {
  subject_id: number;
  program: string;
  course_code: string;
  course_title: string;
  current_printed: number;
  current_digital: number;
  gap: number; // additional titles (printed or ebook) still needed for accreditation
  needs_printed: boolean; // true if a recent printed book specifically is still missing
  /** Which campus(es) offer this subject's program, via program_campuses --
   *  a program can be offered at more than one campus. Empty when no
   *  mapping is configured yet (treated as "not campus-specific" rather
   *  than hidden, same policy used everywhere else campus scope is read). */
  campuses: string[];
  /** Faculty-suggested titles for this course, if any -- full detail (not
   *  just title/author) so a supplier can tell whether they can supply the
   *  exact title requested or need to propose an alternative. */
  recommended_titles: {
    id: number; title: string; author: string; publisher: string; year: string; isbn: string;
    format_preference: string; notes: string; price_estimate: number | null;
  }[];
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

    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;

    type SubjectRec = { id: number; program_id: number; course_code: string; course_title: string };
    const subjects = await pageThrough<SubjectRec>(
      (from, to) => {
        let q = db.from("subjects").select("id, program_id, course_code, course_title").range(from, to);
        if (allowedProgramIds) q = q.in("program_id", allowedProgramIds.size ? Array.from(allowedProgramIds) : [-1]);
        return q as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>;
      },
    );
    if (!subjects.length) return NextResponse.json({ rows: [] });

    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    const programIds = Array.from(new Set(subjects.map((s) => s.program_id)));
    const campusesByProgram = new Map<number, string[]>();
    if (programIds.length) {
      const { data: mappings } = await db.from("program_campuses")
        .select("program_id, campuses(name)").in("program_id", programIds);
      for (const m of (mappings ?? []) as { program_id: number; campuses: { name?: string } | null }[]) {
        const name = m.campuses?.name;
        if (!name) continue;
        if (!campusesByProgram.has(m.program_id)) campusesByProgram.set(m.program_id, []);
        campusesByProgram.get(m.program_id)!.push(name);
      }
    }

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
    const recentMap = new Map<number, number>(); // recent printed+ebook titles (journals/repository excluded)
    const recentPrintedMap = new Map<number, number>(); // of those, printed books specifically
    for (const a of assignments) {
      const t = a.titles;
      if (!t) continue;
      const isPrint = t.format === "book_printed" || t.format === "journal_printed";
      if (isPrint) printedMap.set(a.subject_id, (printedMap.get(a.subject_id) ?? 0) + 1);
      else digitalMap.set(a.subject_id, (digitalMap.get(a.subject_id) ?? 0) + 1);

      const y = parseInt(t.year ?? "", 10);
      if (!isNaN(y) && y >= yearCutoff && countsTowardBookCompliance(t.format)) {
        recentMap.set(a.subject_id, (recentMap.get(a.subject_id) ?? 0) + 1);
        if (isPrintedBook(t.format)) recentPrintedMap.set(a.subject_id, (recentPrintedMap.get(a.subject_id) ?? 0) + 1);
      }
    }

    const { data: recs } = await db.from("title_recommendations")
      .select("id, subject_id, title, author, publisher, year, isbn, format_preference, notes, price_estimate")
      .in("subject_id", subjectIds).in("status", ["pending", "sourced"]);
    const recsBySubject = new Map<number, SupplierNeedRow["recommended_titles"]>();
    for (const r of recs ?? []) {
      if (!recsBySubject.has(r.subject_id)) recsBySubject.set(r.subject_id, []);
      recsBySubject.get(r.subject_id)!.push({
        id: r.id, title: r.title, author: r.author, publisher: r.publisher, year: r.year, isbn: r.isbn,
        format_preference: r.format_preference, notes: r.notes, price_estimate: r.price_estimate ?? null,
      });
    }

    const rows: SupplierNeedRow[] = subjects
      .map((s) => {
        const recent = recentMap.get(s.id) ?? 0;
        const recentPrinted = recentPrintedMap.get(s.id) ?? 0;
        const { gap } = evaluateBookCompliance(recent, recentPrinted);
        return {
          subject_id: s.id,
          program: programMap.get(s.program_id) ?? "",
          course_code: s.course_code,
          course_title: s.course_title,
          current_printed: printedMap.get(s.id) ?? 0,
          current_digital: digitalMap.get(s.id) ?? 0,
          gap,
          needs_printed: recentPrinted < 1,
          campuses: campusesByProgram.get(s.program_id) ?? [],
          recommended_titles: recsBySubject.get(s.id) ?? [],
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
