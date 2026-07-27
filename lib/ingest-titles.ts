/**
 * Shared title-ingestion logic (dedup + insert/update), extracted from
 * /api/upload/[type] so a second source of rows -- a Destiny sync, or any
 * future automated feed -- can reuse the exact same dedup/accession
 * behavior as a manual file upload instead of duplicating it.
 */
import type { serviceClient } from "./supabase";
import type { TitleRow } from "./types";
import type { ResourceType } from "./resources";

export type IngestSend = (e:
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
) => void;

export type IngestResult = { received: number; inserted: number; skipped: number; duplicates?: number };

const BATCH = 500;

/** Ingests already-parsed TitleRows for one resource type, applying the
 *  same accession-mode (printed books: dedupe by barcode, accumulate
 *  copies) or standard dedup-by-identifier logic as a manual upload.
 *  Throws if a campus-scoped row has no resolvable campus. */
export async function ingestTitleRecords(
  db: ReturnType<typeof serviceClient>,
  rt: ResourceType,
  records: TitleRow[],
  batchId: string,
  send: IngestSend,
  defaultCampus = "",
): Promise<IngestResult> {
  if (!records.length) return { received: 0, inserted: 0, skipped: 0 };

  const rowCampus = (r: TitleRow): string => {
    if (!rt.campusScoped) return "";
    const fromRow = (r.campus ?? "").trim();
    return fromRow || defaultCampus;
  };

  for (const r of records) {
    const c = rowCampus(r);
    if (rt.campusScoped && !c) {
      throw new Error(
        `Row "${r.title}" has no campus — set a campus in the upload card (or sync config) or add a "Campus" column to the file.`,
      );
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

    type Existing = { id: number; call_no: string; title: string; author: string; campus: string; copies: number; barcodes: string[] | null };
    const IN_CHUNK = 150;
    async function fetchCandidates(column: string, values: Set<string>): Promise<Existing[]> {
      const out: Existing[] = [];
      const list = Array.from(values);
      for (let i = 0; i < list.length; i += IN_CHUNK) {
        const slice = list.slice(i, i + IN_CHUNK);
        const { data, error } = await db.from("titles")
          .select("id, call_no, title, author, campus, copies, barcodes")
          .eq("format", rt.id).in(column, slice);
        if (error) throw error;
        out.push(...((data ?? []) as unknown as Existing[]));
        send({ phase: "deduping", existing: out.length });
      }
      return out;
    }
    const callNos = new Set<string>();
    const titles = new Set<string>();
    for (const { row } of aggMap.values()) {
      const cn = (row.call_no ?? "").trim();
      if (cn) callNos.add(cn);
      titles.add(row.title);
    }
    const existingByCallNo = callNos.size ? await fetchCandidates("call_no", callNos) : [];
    const existingByTitle = titles.size ? await fetchCandidates("title", titles) : [];
    const existingUnique = new Map<number, Existing>();
    for (const e of [...existingByCallNo, ...existingByTitle]) existingUnique.set(e.id, e);
    const existing = Array.from(existingUnique.values());
    send({ phase: "deduping", existing: existing.length });

    const existingMap = new Map<string, Existing>();
    for (const e of existing) {
      existingMap.set(`${normField(e.call_no ?? "")}|${normField(e.title)}|${normField(e.author ?? "")}|${e.campus ?? ""}`, e);
    }

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: number; copies: number; barcodes: string[] }[] = [];
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
        toUpdate.push({ id: ex.id, copies: ex.copies + newBarcodes + unbarcoded, barcodes: Array.from(existingBarcodes) });
      } else {
        toInsert.push({
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
        });
      }
    }

    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const { data, error } = await db.from("titles").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
      send({ phase: "inserting", inserted, skipped: updated, total: aggMap.size });
    }
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const slice = toUpdate.slice(i, i + BATCH);
      for (const { id, copies, barcodes } of slice) {
        const { error } = await db.from("titles").update({ copies, barcodes }).eq("id", id);
        if (error) throw error;
        updated++;
      }
      send({ phase: "inserting", inserted, skipped: updated, total: aggMap.size });
    }

    return { received: records.length, inserted, skipped: updated, duplicates };
  }

  // ---------------------------------------------------------------------
  // Standard dedup mode (all other resource types).
  // ---------------------------------------------------------------------
  type Existing = { isbn: string; issn: string; call_no: string; title: string; author: string; year: string; campus: string };
  const selectCols = rt.campusScoped
    ? "isbn, issn, call_no, title, author, year, campus"
    : "isbn, issn, call_no, title, author, year";

  const IN_CHUNK = 150;
  async function fetchCandidates(column: string, values: Set<string>): Promise<Existing[]> {
    const out: Existing[] = [];
    const list = Array.from(values);
    for (let i = 0; i < list.length; i += IN_CHUNK) {
      const slice = list.slice(i, i + IN_CHUNK);
      const { data, error } = await db.from("titles")
        .select(selectCols).eq("format", rt.id).in(column, slice);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as Existing[]));
      send({ phase: "deduping", existing: out.length });
    }
    return out;
  }

  const idField: "isbn" | "issn" | "call_no" | null =
    rt.dedupBy === "isbn-or-tuple" ? "isbn" :
    rt.dedupBy === "issn-or-title" ? "issn" :
    "call_no";

  const idValues = new Set<string>();
  const titleValues = new Set<string>();
  for (const r of records) {
    if (idField === "call_no") {
      const v = (r.call_no ?? "").trim();
      if (v) idValues.add(v);
      titleValues.add(r.title);
    } else {
      const v = (idField === "isbn" ? r.isbn : r.issn)?.trim() ?? "";
      if (v) idValues.add(v); else titleValues.add(r.title);
    }
  }

  const existingById = idValues.size ? await fetchCandidates(idField, idValues) : [];
  const existingByTitle = titleValues.size ? await fetchCandidates("title", titleValues) : [];
  const existingKey = (e: Existing) => `${e.isbn}|${e.issn}|${e.call_no}|${e.title}|${e.author}|${e.year}|${e.campus ?? ""}`;
  const existingUnique = new Map<string, Existing>();
  for (const e of [...existingById, ...existingByTitle]) existingUnique.set(existingKey(e), e);
  const existing = Array.from(existingUnique.values());
  send({ phase: "deduping", existing: existing.length });

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

  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batchInput = records.slice(i, i + BATCH);
    const toInsert = [];
    for (const r of batchInput) {
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
        batch_id: batchId,
      };
      if (rt.campusScoped) row.campus = c;
      toInsert.push(row);
    }
    if (toInsert.length) {
      const { data, error } = await db.from("titles").insert(toInsert).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
    }
    send({ phase: "inserting", inserted, skipped, total: records.length });
  }

  return { received: records.length, inserted, skipped };
}
