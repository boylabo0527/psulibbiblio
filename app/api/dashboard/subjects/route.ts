import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { RESOURCE_BY_ID, type ResourceTypeId } from "@/lib/resources";
import { yearInRange } from "@/lib/years";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SubjectSummaryRow = {
  subject_id: number;
  program_id: number;
  program: string;
  course_code: string;
  course_title: string;
  sort_order: number;
  counts: Record<ResourceTypeId, number>;
  total_titles: number;
  total_volumes: number;
};

/** Per program, per journal type: how many distinct journals and how many
 *  volumes -- deduplicated (a journal matched to several subjects in the
 *  same program still counts once), matching how Programs & Export and
 *  ProgramJournalsPanel already count them. Journals aren't in any
 *  subject's own `counts` (see below) since they're not really "this
 *  course's" the way a book is; the caller sums this in separately, once
 *  per program in view, instead of once per subject. */
export type JournalTotals = Record<number, Partial<Record<ResourceTypeId, { titles: number; volumes: number }>>>;

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const programId = u.searchParams.get("program_id");
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const minYearParam = parseInt(u.searchParams.get("from_year") ?? "", 10);
    const maxYearParam = parseInt(u.searchParams.get("to_year") ?? "", 10);
    const minYear = Number.isFinite(minYearParam) ? minYearParam : undefined;
    const maxYear = Number.isFinite(maxYearParam) ? maxYearParam : undefined;
    const db = serviceClient();

    // The Dashboard is intentionally public -- an anonymous visitor is
    // always unrestricted. A signed-in user restricted to specific
    // campuses only sees programs offered there.
    const email = userEmailFromRequest(req);
    let allowedProgramIds: Set<number> | null = null;
    if (email) {
      const perms = await getUserPermissions(db, email);
      if (perms.campusIds !== null) {
        allowedProgramIds = await getAllowedProgramIds(db, perms.campusIds);
        if (programId && !allowedProgramIds.has(Number(programId))) {
          return NextResponse.json({ error: "This program isn't offered at any of your assigned campuses." }, { status: 403 });
        }
      }
    }

    // Subjects (optionally filtered by program).
    type SubjectRec = { id: number; program_id: number; course_code: string; course_title: string; sort_order: number };
    const subjects = await pageThrough<SubjectRec>(
      (from, to) => {
        let q = db.from("subjects")
          .select("id, program_id, course_code, course_title, sort_order")
          .order("program_id")
          .order("sort_order")
          .range(from, to);
        if (programId) q = q.eq("program_id", Number(programId));
        else if (allowedProgramIds) q = q.in("program_id", allowedProgramIds.size ? Array.from(allowedProgramIds) : [-1]);
        return q as unknown as PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>;
      },
    );

    if (!subjects.length) {
      return NextResponse.json({ subjects: [], journalTotals: {} });
    }

    // Programs map for name lookup.
    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    // Assignments with title format, campus, copies, year. `titles.id` is
    // needed (not just format) to dedup a journal matched to several
    // subjects in the same program down to one. `manual` (locked) is needed
    // because an auto-match is a candidate, not a confirmed answer -- this
    // dashboard shows the same validated-only totals as Programs & Export.
    type AssignRow = { subject_id: number; manual: number; titles: { id: number; format: string; campus: string; copies: number; year: string } | null };
    const subjectIds = subjects.map((s) => s.id);
    const assignments: AssignRow[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      // .order("id") is required for a multi-page chunk to come back
      // complete -- without a deterministic sort, Postgres doesn't
      // guarantee a row lands on the same page across repeated .range()
      // calls, so a row can fall into a gap between pages and never come
      // back at all (see lib/bibliography.ts for how this manifested).
      const rows = await pageThrough<AssignRow>(
        (from, to) => db.from("assignments")
          .select("subject_id, manual, titles(id, format, campus, copies, year)")
          .in("subject_id", chunk)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }

    const programBySubject = new Map(subjects.map((s) => [s.id, s.program_id]));

    // Aggregate per subject (books) and per program (journals, deduplicated).
    const countMap = new Map<number, Record<string, number>>();
    const volumeMap = new Map<number, number>();
    const journalMap = new Map<number, Map<ResourceTypeId, { titleIds: Set<number>; volumes: number }>>();
    for (const a of assignments) {
      const t = a.titles;
      if (!t) continue;
      if (!yearInRange(t.year, minYear, maxYear)) continue;

      // Journals are program-wide, not tied to one course (a subscription
      // covers the whole program) -- Programs & Export and
      // ProgramJournalsPanel both already show them once, deduplicated, at
      // the program level instead of under whichever subjects Match
      // happened to attach them to. Folding them into each matched
      // subject's own total here too double- (or many-times-) counted the
      // same subscription and made this table disagree with those views
      // for any program with journal matches -- so they're tallied
      // separately here, once per program, and the caller adds that in.
      if (RESOURCE_BY_ID[t.format as ResourceTypeId]?.kind === "journal") {
        const isCampusScopedJournal = t.format === "journal_printed";
        if (isCampusScopedJournal && campus && t.campus !== campus) continue;
        const pid = programBySubject.get(a.subject_id);
        if (pid == null) continue;
        if (!journalMap.has(pid)) journalMap.set(pid, new Map());
        const byFormat = journalMap.get(pid)!;
        const fmt = t.format as ResourceTypeId;
        if (!byFormat.has(fmt)) byFormat.set(fmt, { titleIds: new Set(), volumes: 0 });
        const agg = byFormat.get(fmt)!;
        if (!agg.titleIds.has(t.id)) {
          agg.titleIds.add(t.id);
          agg.volumes += isCampusScopedJournal ? Math.max(1, t.copies ?? 1) : 1;
        }
        continue;
      }

      // Non-journal titles only count once a librarian has locked (validated)
      // the match -- an auto-match is a candidate, not a confirmed answer.
      // No per-journal lock UI exists yet, so journals (handled above) are
      // deliberately exempt from this filter.
      if (!a.manual) continue;

      const isCampusScopedPrintedBook = t.format === "book_printed";
      if (isCampusScopedPrintedBook && campus && t.campus !== campus) continue;

      const sid = a.subject_id;
      if (!countMap.has(sid)) countMap.set(sid, {});
      const c = countMap.get(sid)!;
      c[t.format] = (c[t.format] ?? 0) + 1;

      const vol = isCampusScopedPrintedBook ? Math.max(1, t.copies ?? 1) : 1;
      volumeMap.set(sid, (volumeMap.get(sid) ?? 0) + vol);
    }

    const rows: SubjectSummaryRow[] = subjects.map((s) => {
      const counts = (countMap.get(s.id) ?? {}) as Record<ResourceTypeId, number>;
      const total_titles = Object.values(counts).reduce((a, b) => a + b, 0);
      const total_volumes = volumeMap.get(s.id) ?? total_titles;
      return {
        subject_id: s.id,
        program_id: s.program_id,
        program: programMap.get(s.program_id) ?? "",
        course_code: s.course_code,
        course_title: s.course_title,
        sort_order: s.sort_order,
        counts,
        total_titles,
        total_volumes,
      };
    });

    const journalTotals: JournalTotals = {};
    for (const [pid, byFormat] of journalMap) {
      journalTotals[pid] = {};
      for (const [fmt, agg] of byFormat) {
        journalTotals[pid][fmt] = { titles: agg.titleIds.size, volumes: agg.volumes };
      }
    }

    return NextResponse.json({ subjects: rows, journalTotals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
