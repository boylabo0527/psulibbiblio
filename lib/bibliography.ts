import { serviceClient } from "./supabase";
import type { ProgramBibliography } from "./exports";
import { RESOURCE_BY_ID, RESOURCE_TYPES, type ResourceTypeId } from "./resources";
import type { SubjectRow, TitleRow } from "./types";
import { yearInRange } from "./years";

const PAGE = 1000;

async function paged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export async function loadProgramBibliography(
  programId: number,
  campus = "",
  subjectId?: number,
  minYear?: number,
  maxYear?: number,
): Promise<ProgramBibliography> {
  const db = serviceClient();
  const { data: progRow, error: progErr } = await db
    .from("programs").select("id, name").eq("id", programId).single();
  if (progErr) throw progErr;

  const subjects = await paged<SubjectRow>((from, to) => {
    let q = db.from("subjects")
      .select("id, program_id, course_code, course_title, description, sort_order, locked")
      .eq("program_id", programId)
      .order("sort_order", { ascending: true })
      .range(from, to);
    if (subjectId) q = q.eq("id", subjectId);
    return q;
  });

  type Joined = { subject_id: number; titles: TitleRow & { format: ResourceTypeId; campus?: string } };
  const assignments = await paged<Joined>((from, to) =>
    db.from("assignments")
      .select("subject_id, titles!inner(id, format, title, author, publisher, year, isbn, issn, call_no, copies, url, campus)")
      .in("subject_id", subjects.length ? subjects.map((s) => s.id!) : [-1])
      .range(from, to),
  );

  // Printed titles are included only when their campus matches the report's
  // campus (or is blank, for legacy / cross-campus rows). Digital titles
  // (eBooks, online journals) are always included. A year-coverage window
  // (if set) additionally excludes titles published outside that range,
  // so outdated titles drop out of the report without deleting the data.
  const includeTitle = (t: { format: ResourceTypeId; campus?: string; year?: string }) => {
    const rt = RESOURCE_BY_ID[t.format];
    if (rt?.campusScoped && campus) {
      const tc = (t.campus ?? "").trim();
      if (tc !== "" && tc !== campus) return false;
    }
    return yearInRange(t.year, minYear, maxYear);
  };

  type Buckets = Record<ResourceTypeId, TitleRow[]>;
  const emptyBuckets = (): Buckets =>
    Object.fromEntries(RESOURCE_TYPES.map((t) => [t.id, [] as TitleRow[]])) as Buckets;

  const bySubject = new Map<number, Buckets>();
  for (const s of subjects) bySubject.set(s.id!, emptyBuckets());
  for (const a of assignments) {
    const bucket = bySubject.get(a.subject_id);
    if (!bucket) continue;
    if (!includeTitle(a.titles)) continue;
    const fmt = a.titles.format;
    if (!(fmt in bucket)) continue;
    bucket[fmt].push(a.titles);
  }
  for (const bucket of bySubject.values()) {
    const sortBooks = (xs: TitleRow[]) =>
      xs.sort((a, b) => (b.year || "").localeCompare(a.year || "") || a.title.localeCompare(b.title));
    for (const t of RESOURCE_TYPES) sortBooks(bucket[t.id]);
  }

  // Sections were dropped from the curriculum schema; emit a single
  // unlabeled section that contains every subject in upload order.
  const bySection = [{
    section: "",
    subjects: subjects.map((subject) => ({
      subject,
      buckets: bySubject.get(subject.id!)!,
    })),
  }];

  return {
    program: progRow as ProgramBibliography["program"],
    campus,
    bySection,
  };
}
