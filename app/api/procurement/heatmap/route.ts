import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";

const ACCREDITATION_MIN = 5;
const PARTIAL_MIN = 3;
const RECENCY_YEARS = 5;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HeatmapCell = {
  program_id: number;
  program: string;
  campus: string;
  totalSubjects: number;
  compliant: number;
  partial: number;
  needs: number;
  complianceRate: number; // 0-100, share of subjects fully compliant
};

/** Per-program × per-campus compliance summary, for a heatmap view of where
 *  procurement gaps are across campuses offering the same program. */
export async function GET() {
  try {
    const db = serviceClient();
    const currentYear = new Date().getFullYear();
    const yearCutoff = currentYear - RECENCY_YEARS;

    type SubjectRec = { id: number; program_id: number };
    const subjects = await pageThrough<SubjectRec>(
      (from, to) => db.from("subjects").select("id, program_id").range(from, to) as unknown as
        PromiseLike<{ data: SubjectRec[] | null; error: { message: string } | null }>,
    );
    if (!subjects.length) return NextResponse.json({ cells: [] });

    const { data: programRows } = await db.from("programs").select("id, name");
    const programMap = new Map((programRows ?? []).map((p: { id: number; name: string }) => [p.id, p.name]));

    const { data: campusRows } = await db.from("campuses").select("name");
    const allCampuses = (campusRows ?? []).map((c: { name: string }) => c.name);

    type MappingRow = { program_id: number; campuses: { name: string } | null };
    const mappingRows = await pageThrough<MappingRow>(
      (from, to) => db.from("program_campuses").select("program_id, campuses(name)").range(from, to) as unknown as
        PromiseLike<{ data: MappingRow[] | null; error: { message: string } | null }>,
    );
    const offeredAt = new Map<number, Set<string>>();
    for (const m of mappingRows) {
      if (!m.campuses?.name) continue;
      if (!offeredAt.has(m.program_id)) offeredAt.set(m.program_id, new Set());
      offeredAt.get(m.program_id)!.add(m.campuses.name);
    }
    // A program with no rows in program_campuses is unmapped — treated as
    // offered everywhere (consistent with isProgramAtCampus elsewhere).
    const campusesForProgram = (programId: number): string[] => {
      const set = offeredAt.get(programId);
      return set && set.size > 0 ? Array.from(set) : allCampuses;
    };

    type AssignRow = { subject_id: number; titles: { format: string; campus: string; year: string | null } | null };
    const subjectIds = subjects.map((s) => s.id);
    const assignments: AssignRow[] = [];
    for (let i = 0; i < subjectIds.length; i += 200) {
      const chunk = subjectIds.slice(i, i + 200);
      const rows = await pageThrough<AssignRow>(
        (from, to) => db.from("assignments")
          .select("subject_id, titles(format, campus, year)")
          .in("subject_id", chunk)
          .range(from, to) as unknown as PromiseLike<{ data: AssignRow[] | null; error: { message: string } | null }>,
      );
      assignments.push(...rows);
    }

    // recent_titles(subject, campus) = baseRecent[subject] (non-campus-scoped
    // formats, same everywhere) + perCampusRecent[subject][campus] (printed
    // formats, specific to that campus's copies).
    const baseRecent = new Map<number, number>();
    const perCampusRecent = new Map<number, Map<string, number>>();
    for (const a of assignments) {
      const t = a.titles;
      if (!t) continue;
      const titleYear = parseInt(t.year ?? "", 10);
      if (isNaN(titleYear) || titleYear < yearCutoff) continue;
      const isCampusScoped = t.format === "book_printed" || t.format === "journal_printed";
      if (isCampusScoped) {
        if (!perCampusRecent.has(a.subject_id)) perCampusRecent.set(a.subject_id, new Map());
        const m = perCampusRecent.get(a.subject_id)!;
        m.set(t.campus, (m.get(t.campus) ?? 0) + 1);
      } else {
        baseRecent.set(a.subject_id, (baseRecent.get(a.subject_id) ?? 0) + 1);
      }
    }

    const subjectsByProgram = new Map<number, SubjectRec[]>();
    for (const s of subjects) {
      if (!subjectsByProgram.has(s.program_id)) subjectsByProgram.set(s.program_id, []);
      subjectsByProgram.get(s.program_id)!.push(s);
    }

    const cells: HeatmapCell[] = [];
    for (const [programId, progSubjects] of subjectsByProgram) {
      const campusesHere = campusesForProgram(programId);
      for (const campus of campusesHere) {
        let compliant = 0, partial = 0, needs = 0;
        for (const s of progSubjects) {
          const recent = (baseRecent.get(s.id) ?? 0) + (perCampusRecent.get(s.id)?.get(campus) ?? 0);
          if (recent >= ACCREDITATION_MIN) compliant++;
          else if (recent >= PARTIAL_MIN) partial++;
          else needs++;
        }
        const total = progSubjects.length;
        cells.push({
          program_id: programId,
          program: programMap.get(programId) ?? "",
          campus,
          totalSubjects: total,
          compliant, partial, needs,
          complianceRate: total > 0 ? Math.round((compliant / total) * 100) : 0,
        });
      }
    }

    return NextResponse.json({ cells });
  } catch (err) {
    const msg = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
