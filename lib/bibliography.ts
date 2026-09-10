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
  /** When given, only these resource types (Printed Books, Subscribed
   *  eBooks, etc.) are included -- everything else (on-screen buckets,
   *  every export format, citations) is empty for the rest. undefined
   *  means no filtering, i.e. every type included, same as before this
   *  parameter existed. An empty array is a deliberate "include nothing",
   *  not the same as undefined. */
  types?: ResourceTypeId[],
): Promise<ProgramBibliography> {
  const db = serviceClient();
  const { data: progRow, error: progErr } = await db
    .from("programs").select("id, name").eq("id", programId).single();
  if (progErr) throw progErr;

  const subjects = await paged<SubjectRow>((from, to) => {
    let q = db.from("subjects")
      .select("id, program_id, course_code, course_title, description, sort_order")
      .eq("program_id", programId)
      .order("sort_order", { ascending: true })
      .range(from, to);
    if (subjectId) q = q.eq("id", subjectId);
    return q;
  });

  // Chunked 200 subject ids at a time (same pattern as
  // /api/dashboard/subjects, /api/procurement, and /api/standard-titles/
  // compare) -- a program with enough subjects (General Education, shared
  // across every degree program, easily has hundreds) can build an
  // `.in(...)` filter long enough to get silently truncated before it ever
  // reaches the database, dropping most subjects from the result with no
  // error at all. That's a much worse failure than one extra round trip:
  // a course's real, already-matched titles just never show up anywhere
  // that uses this data (the page itself and every export), and there's
  // nothing in the response to say why.
  type Joined = { subject_id: number; manual: number; titles: TitleRow & { format: ResourceTypeId; campus?: string } };
  const subjectIds = subjects.length ? subjects.map((s) => s.id!) : [-1];
  const assignments: Joined[] = [];
  for (let i = 0; i < subjectIds.length; i += 200) {
    const chunk = subjectIds.slice(i, i + 200);
    // .order("id") is required, not cosmetic: without an explicit,
    // deterministic sort, Postgres doesn't guarantee the same row lands on
    // the same page across the repeated .range() calls a multi-page chunk
    // needs -- a row can fall into a gap between two pages and never come
    // back at all, with the total row count still looking plausible. This
    // is exactly how a course's real, already-matched titles could vanish
    // from every view built on this data with no error anywhere to explain
    // it (confirmed: the same subject fetched alone came back complete,
    // but as part of a larger program came back with none of its titles).
    const chunkRows = await paged<Joined>((from, to) =>
      db.from("assignments")
        .select("subject_id, manual, titles!inner(id, format, title, author, publisher, year, isbn, issn, call_no, copies, url, campus)")
        .in("subject_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );
    assignments.push(...chunkRows);
  }

  const typeSet = types ? new Set(types) : undefined;

  // Printed titles are included only when their campus matches the report's
  // campus. Digital titles (eBooks, online journals) are always included.
  // A year-coverage window (if set) additionally excludes titles published
  // outside that range, so outdated titles drop out of the report without
  // deleting the data. A resource-type filter (if set) additionally
  // excludes any format not explicitly selected.
  const includeTitle = (t: { format: ResourceTypeId; campus?: string; year?: string }) => {
    if (typeSet && !typeSet.has(t.format)) return false;
    const rt = RESOURCE_BY_ID[t.format];
    if (rt?.campusScoped && campus) {
      const tc = (t.campus ?? "").trim();
      if (tc !== campus) return false;
    }
    return yearInRange(t.year, minYear, maxYear);
  };

  type Buckets = Record<ResourceTypeId, TitleRow[]>;
  const emptyBuckets = (): Buckets =>
    Object.fromEntries(RESOURCE_TYPES.map((t) => [t.id, [] as TitleRow[]])) as Buckets;

  const bySubject = new Map<number, Buckets>();
  for (const s of subjects) bySubject.set(s.id!, emptyBuckets());

  // Journals are a program-wide subscription, not a per-course resource --
  // Match can reasonably assign the same journal to every subject in a
  // program, which would otherwise repeat an identical entry under each
  // one. Collected into one program-wide, deduplicated-by-title list
  // instead of each subject's own buckets.
  const journalsById = new Map<ResourceTypeId, Map<number, TitleRow>>(
    RESOURCE_TYPES.filter((t) => t.kind === "journal").map((t) => [t.id, new Map<number, TitleRow>()]),
  );

  for (const a of assignments) {
    if (!includeTitle(a.titles)) continue;
    const fmt = a.titles.format;
    const title = { ...a.titles, manual: a.manual };
    const journalMap = journalsById.get(fmt);
    if (journalMap) {
      if (title.id != null && !journalMap.has(title.id)) journalMap.set(title.id, title);
      continue;
    }
    const bucket = bySubject.get(a.subject_id);
    if (!bucket) continue;
    if (!(fmt in bucket)) continue;
    bucket[fmt].push(title);
  }

  const journals = emptyBuckets();
  for (const [fmt, map] of journalsById) journals[fmt] = Array.from(map.values());

  const sortBooks = (xs: TitleRow[]) =>
    xs.sort((a, b) => (b.year || "").localeCompare(a.year || "") || a.title.localeCompare(b.title));
  for (const bucket of bySubject.values()) {
    for (const t of RESOURCE_TYPES) sortBooks(bucket[t.id]);
  }
  for (const t of RESOURCE_TYPES) sortBooks(journals[t.id]);

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
    journals,
  };
}

/** Some curricula split "common"/general-education courses into their own
 *  program record, separate from each major's program (e.g. a shared "BSED
 *  Common Courses" program plus "BSED Major in Math", "BSED Major in
 *  English", ...) so Match/locking for the shared courses isn't repeated
 *  per major. That split is invisible to an accreditation reviewer, who
 *  expects one bibliography for "BSED Major in Math" covering everything
 *  the student actually takes -- this combines two or more programs' own
 *  loadProgramBibliography results into a single report, one labeled
 *  section per source program (every export format in lib/exports.ts
 *  already renders bySection[].section as a heading when it's non-empty,
 *  so no export-side changes are needed), with journal holdings merged and
 *  deduplicated by title across the combined set. */
export async function loadCombinedProgramBibliography(
  programIds: number[],
  campus = "",
  minYear?: number,
  maxYear?: number,
  types?: ResourceTypeId[],
): Promise<ProgramBibliography> {
  const results = await Promise.all(
    programIds.map((id) => loadProgramBibliography(id, campus, undefined, minYear, maxYear, types)),
  );

  const bySection = results.flatMap((r) =>
    r.bySection.map((sec) => ({ section: sec.section || r.program.name, subjects: sec.subjects })),
  );

  type Buckets = Record<ResourceTypeId, TitleRow[]>;
  const journals: Buckets = Object.fromEntries(RESOURCE_TYPES.map((t) => [t.id, [] as TitleRow[]])) as Buckets;
  const seenByFormat = new Map<ResourceTypeId, Set<number>>();
  for (const r of results) {
    for (const t of RESOURCE_TYPES) {
      if (t.kind !== "journal") continue;
      if (!seenByFormat.has(t.id)) seenByFormat.set(t.id, new Set());
      const seen = seenByFormat.get(t.id)!;
      for (const title of r.journals[t.id]) {
        if (title.id != null) {
          if (seen.has(title.id)) continue;
          seen.add(title.id);
        }
        journals[t.id].push(title);
      }
    }
  }
  const sortBooks = (xs: TitleRow[]) =>
    xs.sort((a, b) => (b.year || "").localeCompare(a.year || "") || a.title.localeCompare(b.title));
  for (const t of RESOURCE_TYPES) sortBooks(journals[t.id]);

  return {
    program: { id: programIds[0], name: results.map((r) => r.program.name).join(" + ") },
    campus,
    bySection,
    journals,
  };
}
