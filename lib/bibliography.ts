import { serviceClient } from "./supabase";
import type { ProgramBibliography } from "./exports";
import { RESOURCE_BY_ID, RESOURCE_TYPES, type ResourceTypeId } from "./resources";
import type { SubjectRow, TitleRow } from "./types";

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

export async function loadProgramBibliography(programId: number): Promise<ProgramBibliography> {
  const db = serviceClient();
  const { data: progRow, error: progErr } = await db
    .from("programs").select("id, campus, college, name").eq("id", programId).single();
  if (progErr) throw progErr;

  const subjects = await paged<SubjectRow>((from, to) =>
    db.from("subjects")
      .select("id, program_id, section, course_code, course_title, description, sort_order")
      .eq("program_id", programId)
      .order("sort_order", { ascending: true })
      .range(from, to),
  );

  type Joined = { subject_id: number; titles: TitleRow & { format: ResourceTypeId; campus?: string } };
  const assignments = await paged<Joined>((from, to) =>
    db.from("assignments")
      .select("subject_id, titles!inner(id, format, title, author, publisher, year, isbn, issn, call_no, copies, url, campus)")
      .in("subject_id", subjects.length ? subjects.map((s) => s.id!) : [-1])
      .range(from, to),
  );

  // Printed titles only belong to a program if their campus matches the
  // program's campus (or is blank, treated as legacy / cross-campus).
  const programCampus = (progRow as { campus?: string }).campus ?? "";
  const includeTitle = (t: { format: ResourceTypeId; campus?: string }) => {
    const rt = RESOURCE_BY_ID[t.format];
    if (!rt?.campusScoped) return true;
    const tc = (t.campus ?? "").trim();
    return tc === "" || tc === programCampus;
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

  const sectionOrder: string[] = [];
  const sectionMap = new Map<string, typeof subjects>();
  for (const s of subjects) {
    const key = s.section || "";
    if (!sectionMap.has(key)) { sectionMap.set(key, []); sectionOrder.push(key); }
    sectionMap.get(key)!.push(s);
  }
  const bySection = sectionOrder.map((section) => ({
    section,
    subjects: sectionMap.get(section)!.map((subject) => ({
      subject,
      buckets: bySubject.get(subject.id!)!,
    })),
  }));

  return { program: progRow as ProgramBibliography["program"], bySection };
}
