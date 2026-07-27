/**
 * Shared title-ingestion logic (dedup + insert/update), extracted from
 * /api/upload/[type] so a second source of rows -- a Destiny sync, or any
 * future automated feed -- can reuse the exact same dedup/accession
 * behavior as a manual file upload instead of duplicating it.
 *
 * Split into a planning phase (planIngestOps -- reads the DB to work out
 * exactly what to insert/update, but writes nothing) and an execution
 * phase (applyIngestOps -- does the actual writes, batched and optionally
 * time-boxed). A manual file upload runs both in one request via
 * ingestTitleRecords(). A large automated sync (see app/api/sync/destiny)
 * instead persists the plan and calls applyIngestOps repeatedly across
 * several short requests, since a catalog with tens of thousands of rows
 * can easily take longer than a single Vercel function invocation is
 * allowed to run on the Hobby (free) plan.
 */
import type { serviceClient } from "./supabase";
import type { TitleRow } from "./types";
import type { ResourceType } from "./resources";
import { pageThroughParallel } from "./paging";

export type IngestSend = (e:
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
) => void;

export type IngestResult = { received: number; inserted: number; skipped: number; duplicates?: number; noCampusTitles?: string[] };

const BATCH = 500;

// Rather than fail an entire batch over one row missing a campus (a single
// bad Destiny sublocation, or a file with one blank cell, shouldn't block
// hundreds of otherwise-good rows), a campus-scoped row with no resolvable
// campus is filed under this fallback and flagged in the result/activity
// log for someone to go back and correct later.
const FALLBACK_CAMPUS = "Main Campus";

export type IngestOp =
  | { kind: "insert"; row: Record<string, unknown> }
  // format/title are titles' only NOT NULL columns without a default, so
  // an update op has to carry them even though they never actually
  // change: applyIngestOps/processSyncJobChunk do this update as an
  // upsert() (one round trip for many rows instead of one per row --
  // see there for why), and Postgres validates NOT NULL on the row
  // INSERT ... ON CONFLICT attempts to build BEFORE it even gets to
  // checking whether a conflict exists, so omitting them fails outright
  // with "null value in column ... violates not-null constraint" rather
  // than quietly updating just the listed columns.
  | { kind: "update"; id: number; format: string; title: string; copies: number; barcodes: string[] };

export type IngestPlan = {
  ops: IngestOp[];
  mode: "accession" | "standard";
  duplicates?: number;  // accession mode: rows that matched an existing copy exactly (same barcode already on file)
  skipped?: number;      // standard mode: rows dropped as duplicates before any op was even built
  noCampusTitles: string[];
  received: number;
};

/** Reads the DB to work out exactly what needs inserting/updating for this
 *  batch of rows, without writing anything -- see applyIngestOps for the
 *  write side. Mirrors ingestTitleRecords' old all-in-one dedup logic. */
export async function planIngestOps(
  db: ReturnType<typeof serviceClient>,
  rt: ResourceType,
  records: TitleRow[],
  batchId: string,
  defaultCampus = "",
  send: IngestSend = () => {},
): Promise<IngestPlan> {
  const mode = rt.accessionMode ? "accession" : "standard";
  if (!records.length) return { ops: [], mode, noCampusTitles: [], received: 0 };

  const rowCampus = (r: TitleRow): string => {
    if (!rt.campusScoped) return "";
    const fromRow = (r.campus ?? "").trim();
    return fromRow || defaultCampus;
  };

  const noCampusTitles: string[] = [];
  if (rt.campusScoped) {
    for (const r of records) {
      if (!rowCampus(r)) {
        r.campus = FALLBACK_CAMPUS;
        noCampusTitles.push(r.title);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Accession mode (Printed Books): each row = 1 physical copy.
  // ---------------------------------------------------------------------
  if (rt.accessionMode) {
    const normField = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
    const keyOf = (r: TitleRow, c: string) =>
      `${normField(r.call_no ?? "")}|${normField(r.title)}|${normField(r.author ?? "")}|${c}`;

    type AggRow = { row: TitleRow; campus: string; barcodes: Set<string>; unbarcoded: number };
    const aggMap = new Map<string, AggRow>();
    for (const r of records) {
      const c = rowCampus(r);
      const k = keyOf(r, c);
      let agg = aggMap.get(k);
      if (!agg) { agg = { row: r, campus: c, barcodes: new Set(), unbarcoded: 0 }; aggMap.set(k, agg); }
      const bc = (r.barcode ?? "").trim();
      if (bc) agg.barcodes.add(bc);
      else agg.unbarcoded += r.copies ?? 1;
    }

    // Fetching every existing row of this format (paged, several pages at
    // once via pageThroughParallel) beats narrowing down to just the
    // call_no/title values this batch actually needs: narrowing means one
    // network round trip per ~150 distinct values, and a sync that's
    // re-covering most of an existing catalog can have thousands of those
    // -- each round trip's fixed latency (not the bytes moved) is what
    // was actually slow enough to hit a serverless function's time limit.
    type Existing = { id: number; call_no: string; title: string; author: string; campus: string; copies: number; barcodes: string[] | null };
    const existing = await pageThroughParallel<Existing>(
      (from, to) => db.from("titles")
        .select("id, call_no, title, author, campus, copies, barcodes", { count: "exact" })
        .eq("format", rt.id).order("id", { ascending: true }).range(from, to) as unknown as
        PromiseLike<{ data: Existing[] | null; count: number | null; error: { message: string } | null }>,
      (done) => send({ phase: "deduping", existing: done }),
    );

    const existingMap = new Map<string, Existing>();
    for (const e of existing) {
      existingMap.set(`${normField(e.call_no ?? "")}|${normField(e.title)}|${normField(e.author ?? "")}|${e.campus ?? ""}`, e);
    }

    const ops: IngestOp[] = [];
    let duplicates = 0;

    for (const [k, { row, campus: c, barcodes, unbarcoded }] of aggMap) {
      const ex = existingMap.get(k);
      if (ex) {
        const existingBarcodes = new Set(ex.barcodes ?? []);
        let newBarcodes = 0;
        for (const bc of barcodes) {
          if (!existingBarcodes.has(bc)) { existingBarcodes.add(bc); newBarcodes++; }
        }
        if (newBarcodes === 0 && unbarcoded === 0) {
          duplicates++;
          continue;
        }
        ops.push({ kind: "update", id: ex.id, format: rt.id, title: ex.title, copies: ex.copies + newBarcodes + unbarcoded, barcodes: Array.from(existingBarcodes) });
      } else {
        ops.push({
          kind: "insert",
          row: {
            format: rt.id,
            title: row.title,
            author: row.author ?? "",
            publisher: row.publisher ?? "",
            year: row.year ?? "",
            isbn: row.isbn ?? "",
            issn: row.issn ?? "",
            call_no: row.call_no ?? "",
            copies: barcodes.size + unbarcoded,
            url: row.url ?? "",
            subjects: row.subjects ?? "",
            campus: c,
            barcodes: Array.from(barcodes),
            batch_id: batchId,
          },
        });
      }
    }

    return { ops, mode: "accession", duplicates, noCampusTitles, received: records.length };
  }

  // ---------------------------------------------------------------------
  // Standard dedup mode (all other resource types).
  // ---------------------------------------------------------------------
  type Existing = { isbn: string; issn: string; call_no: string; title: string; author: string; year: string; campus: string };
  const selectCols = rt.campusScoped
    ? "isbn, issn, call_no, title, author, year, campus"
    : "isbn, issn, call_no, title, author, year";

  // See the accession-mode branch above for why this fetches the whole
  // existing catalog for this format instead of narrowing down to just
  // the values this batch needs -- fewer, larger round trips beat many
  // small ones against a serverless function's time budget.
  const existing = await pageThroughParallel<Existing>(
    (from, to) => db.from("titles")
      .select(selectCols, { count: "exact" })
      .eq("format", rt.id).order("id", { ascending: true }).range(from, to) as unknown as
      PromiseLike<{ data: Existing[] | null; count: number | null; error: { message: string } | null }>,
    (done) => send({ phase: "deduping", existing: done }),
  );

  const isbnSeen = new Set<string>();
  const issnSeen = new Set<string>();
  const tupleSeen = new Set<string>();
  const campusKey = (c: string) => (rt.campusScoped ? `|${c}` : "");
  for (const e of existing) {
    switch (rt.dedupBy) {
      case "isbn-or-tuple":
        if (e.isbn) isbnSeen.add(e.isbn);
        else tupleSeen.add(`${e.title}|${e.author}|${e.year}`);
        break;
      case "callno-title-author":
        tupleSeen.add(`${e.call_no}|${e.title}|${e.author}${campusKey(e.campus ?? "")}`);
        break;
      case "callno-title-issn":
        tupleSeen.add(`${e.call_no}|${e.title}|${e.issn}${campusKey(e.campus ?? "")}`);
        break;
      case "issn-or-title":
        if (e.issn) issnSeen.add(e.issn);
        else tupleSeen.add(e.title);
        break;
    }
  }

  const shouldKeep = (r: TitleRow, c: string): boolean => {
    switch (rt.dedupBy) {
      case "isbn-or-tuple": {
        const isbn = (r.isbn ?? "").trim();
        if (isbn) {
          if (isbnSeen.has(isbn)) return false;
          isbnSeen.add(isbn);
        } else {
          const key = `${r.title}|${r.author ?? ""}|${r.year ?? ""}`;
          if (tupleSeen.has(key)) return false;
          tupleSeen.add(key);
        }
        return true;
      }
      case "callno-title-author": {
        const key = `${r.call_no ?? ""}|${r.title}|${r.author ?? ""}${campusKey(c)}`;
        if (tupleSeen.has(key)) return false;
        tupleSeen.add(key);
        return true;
      }
      case "callno-title-issn": {
        const key = `${r.call_no ?? ""}|${r.title}|${r.issn ?? ""}${campusKey(c)}`;
        if (tupleSeen.has(key)) return false;
        tupleSeen.add(key);
        return true;
      }
      case "issn-or-title": {
        const issn = (r.issn ?? "").trim();
        if (issn) {
          if (issnSeen.has(issn)) return false;
          issnSeen.add(issn);
        } else {
          if (tupleSeen.has(r.title)) return false;
          tupleSeen.add(r.title);
        }
        return true;
      }
    }
  };

  const ops: IngestOp[] = [];
  let skipped = 0;
  for (const r of records) {
    const c = rowCampus(r);
    if (!shouldKeep(r, c)) { skipped++; continue; }
    const row: Record<string, unknown> = {
      format: rt.id,
      title: r.title,
      author: r.author ?? "",
      publisher: r.publisher ?? "",
      year: r.year ?? "",
      isbn: r.isbn ?? "",
      issn: r.issn ?? "",
      call_no: r.call_no ?? "",
      copies: r.copies ?? 1,
      url: r.url ?? "",
      subjects: r.subjects ?? "",
      provider: r.provider ?? "",
      batch_id: batchId,
    };
    if (rt.campusScoped) row.campus = c;
    ops.push({ kind: "insert", row });
  }

  return { ops, mode: "standard", skipped, noCampusTitles, received: records.length };
}

/** Executes a slice of a plan's ops, in batches, stopping either when the
 *  whole list is done or when budgetMs has elapsed (whichever comes
 *  first) -- so a caller can pass a large budget to run to completion in
 *  one call, or a short one to do a bounded chunk per request and resume
 *  from the returned cursor next time. */
export async function applyIngestOps(
  db: ReturnType<typeof serviceClient>,
  ops: IngestOp[],
  startCursor: number,
  budgetMs: number,
  onBatch?: (state: { cursor: number; inserted: number; updated: number }) => void,
): Promise<{ cursor: number; inserted: number; updated: number; done: boolean }> {
  const deadline = Date.now() + budgetMs;
  let cursor = startCursor;
  let inserted = 0;
  let updated = 0;
  while (cursor < ops.length && Date.now() < deadline) {
    const end = Math.min(cursor + BATCH, ops.length);
    const slice = ops.slice(cursor, end);
    const inserts = slice.filter((o): o is Extract<IngestOp, { kind: "insert" }> => o.kind === "insert").map((o) => o.row);
    const updates = slice.filter((o): o is Extract<IngestOp, { kind: "update" }> => o.kind === "update");
    if (inserts.length) {
      const { error } = await db.from("titles").insert(inserts);
      if (error) throw error;
      inserted += inserts.length;
    }
    if (updates.length) {
      // upsert(), not one update() per row: a single round trip per batch
      // instead of one per row is the difference between this finishing
      // in seconds vs. running long enough to hit a serverless timeout.
      // format/title are included solely to satisfy titles' NOT NULL
      // constraints on the row Postgres builds to test for a conflict
      // (see the IngestOp comment above) -- they're set to their current,
      // unchanged values, so only copies/barcodes actually end up
      // different after the update.
      const { error } = await db.from("titles").upsert(
        updates.map((u) => ({ id: u.id, format: u.format, title: u.title, copies: u.copies, barcodes: u.barcodes })),
      );
      if (error) throw error;
      updated += updates.length;
    }
    cursor = end;
    onBatch?.({ cursor, inserted, updated });
  }
  return { cursor, inserted, updated, done: cursor >= ops.length };
}

function combineResult(plan: IngestPlan, applied: { inserted: number; updated: number }): IngestResult {
  if (plan.mode === "accession") {
    return {
      received: plan.received, inserted: applied.inserted, skipped: applied.updated,
      duplicates: plan.duplicates, noCampusTitles: plan.noCampusTitles,
    };
  }
  return {
    received: plan.received, inserted: applied.inserted, skipped: plan.skipped ?? 0,
    noCampusTitles: plan.noCampusTitles,
  };
}

/** Plans and fully executes a batch of rows in one call -- used by the
 *  manual file-upload route, where a whole upload comfortably finishes
 *  within one request. Large automated feeds (Destiny) should use
 *  planIngestOps + applyIngestOps directly instead, spread across several
 *  requests -- see app/api/sync/destiny. */
export async function ingestTitleRecords(
  db: ReturnType<typeof serviceClient>,
  rt: ResourceType,
  records: TitleRow[],
  batchId: string,
  send: IngestSend,
  defaultCampus = "",
): Promise<IngestResult> {
  const plan = await planIngestOps(db, rt, records, batchId, defaultCampus, send);
  if (!plan.ops.length) return combineResult(plan, { inserted: 0, updated: 0 });
  const applied = await applyIngestOps(db, plan.ops, 0, Number.POSITIVE_INFINITY, (state) => {
    send({ phase: "inserting", inserted: state.inserted, skipped: state.updated, total: plan.ops.length });
  });
  return combineResult(plan, applied);
}
