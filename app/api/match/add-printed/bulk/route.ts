import { RESOURCE_BY_ID } from "@/lib/resources";
import { parsePrintedBooks, buildTitleRowsFromRaw } from "@/lib/parsers";
import { ingestTitleRecords, type IngestSend } from "@/lib/ingest-titles";
import { pageThrough } from "@/lib/paging";
import { serviceClient } from "@/lib/supabase";
import type { TitleRow } from "@/lib/types";
import { ndjsonStream } from "@/lib/streaming";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type BulkAddPrintedEvent =
  | { phase: "parsing" }
  | { phase: "parsed"; total: number }
  | { phase: "deduping"; existing: number }
  | { phase: "inserting"; inserted: number; skipped: number; total: number }
  | { phase: "assigning"; done: number; total: number }
  | { phase: "done"; received: number; inserted: number; updated: number; assigned: number; alreadyAssigned: number }
  | { phase: "error"; error: string };

// Mirrors the accession-mode key in lib/ingest-titles.ts so a row that
// ingestTitleRecords just inserted or updated (accumulated copies onto)
// can be found again by the same identity afterward.
const normField = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const keyOf = (r: { call_no?: string | null; title: string; author?: string | null }) =>
  `${normField(r.call_no ?? "")}|${normField(r.title)}|${normField(r.author ?? "")}`;

/** POST /api/match/add-printed/bulk -- from Programs & Export, add many
 *  printed books to one course in a single upload instead of searching
 *  and clicking "add" one at a time. Accepts the same file/row shape as
 *  the main Printed Books upload (Call No., Author, Title, Publisher,
 *  Year, Copies, optional Barcode) -- either multipart/form-data (`file`,
 *  `subject_id`, `campus`) or JSON (`rows` already parsed in the browser,
 *  `filename`, `subject_id`, `campus`).
 *
 *  Reuses ingestTitleRecords (the exact same insert/dedup/copy-accumulate
 *  logic as the main upload) rather than a second, divergent path, so a
 *  book that already exists in this campus's catalog gets its copies
 *  bumped instead of duplicated -- then resolves the touched titles back
 *  by the same identity key and assigns them to the course (manual=1,
 *  same as adding one title by hand). Requires only the Programs & Export
 *  "edit" permission, not Upload's -- the point is curating one course's
 *  list, and a new title record is just a side effect of that. */
export async function POST(req: Request) {
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  let subjectId = 0;
  let campus = "";
  let preRows: Record<string, string>[] | null = null;
  let file: File | null = null;

  if (isJson) {
    const body = await req.json().catch(() => ({})) as {
      subject_id?: number; campus?: string; rows?: Record<string, string>[]; filename?: string;
    };
    subjectId = Number(body.subject_id) || 0;
    campus = (body.campus ?? "").trim();
    preRows = body.rows ?? [];
    file = { name: body.filename ?? "upload.xlsx" } as File;
  } else {
    const form = await req.formData();
    file = form.get("file") as File | null;
    subjectId = Number(form.get("subject_id")) || 0;
    campus = ((form.get("campus") as string | null) ?? "").trim();
  }

  const db = serviceClient();
  const email = userEmailFromRequest(req);
  const perms = await getUserPermissions(db, email);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return new Response(JSON.stringify({ error: "Your account doesn't have permission to change assignments." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  if (!subjectId) {
    return new Response(JSON.stringify({ error: "subject_id is required." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!campus) {
    return new Response(JSON.stringify({ error: "A campus is required -- printed books are tracked per campus." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!file) {
    return new Response(JSON.stringify({ error: "No file uploaded." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: subj } = await db.from("subjects").select("id, program_id, course_code, course_title").eq("id", subjectId).maybeSingle();
  if (!subj) {
    return new Response(JSON.stringify({ error: "Course not found." }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }
  if (!(await isProgramInScope(db, perms, subj.program_id))) {
    return new Response(JSON.stringify({ error: "This course isn't offered at any of your assigned campuses." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const batchId = randomUUID();
  const rt = RESOURCE_BY_ID.book_printed;

  const stream = ndjsonStream<BulkAddPrintedEvent>(async (send) => {
    send({ phase: "parsing" });
    let records: TitleRow[];
    if (preRows) {
      records = buildTitleRowsFromRaw(file!.name, preRows, rt);
    } else {
      records = await parsePrintedBooks(file!.name, Buffer.from(await file!.arrayBuffer()));
    }
    // This upload is scoped to one course/campus context -- force every
    // row to it (ignoring any stray Campus column) so a template meant
    // for the main multi-campus catalog upload still behaves sanely here.
    for (const r of records) r.campus = campus;
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, updated: 0, assigned: 0, alreadyAssigned: 0 });
      return;
    }

    const result = await ingestTitleRecords(db, rt, records, batchId, send as IngestSend, campus);

    // Resolve the batch's rows back to title ids by the same identity
    // ingestTitleRecords just used, narrowed to the distinct titles in
    // this batch (not the whole campus catalog) to keep this fast and
    // avoid re-fetching everything ingestTitleRecords already scanned.
    const wantedKeys = new Set(records.map((r) => keyOf(r)));
    const uniqueTitles = Array.from(new Set(records.map((r) => r.title)));
    type Existing = { id: number; call_no: string | null; title: string; author: string | null };
    const candidates: Existing[] = [];
    for (let i = 0; i < uniqueTitles.length; i += 200) {
      const chunk = uniqueTitles.slice(i, i + 200);
      const rows = await pageThrough<Existing>((from, to) =>
        db.from("titles")
          .select("id, call_no, title, author")
          .eq("format", "book_printed").eq("campus", campus)
          .in("title", chunk)
          .range(from, to) as unknown as PromiseLike<{ data: Existing[] | null; error: { message: string } | null }>,
      );
      candidates.push(...rows);
    }
    const titleIds = candidates.filter((c) => wantedKeys.has(keyOf(c))).map((c) => c.id);

    send({ phase: "assigning", done: 0, total: titleIds.length });
    let assigned = 0;
    if (titleIds.length) {
      const { data: already } = await db.from("assignments")
        .select("title_id").eq("subject_id", subjectId).in("title_id", titleIds);
      const alreadySet = new Set((already ?? []).map((a) => a.title_id as number));
      const newRows = titleIds
        .filter((id) => !alreadySet.has(id))
        .map((title_id) => ({ subject_id: subjectId, title_id, score: 1, rank: 0, explanation: "Manual", manual: 1 }));
      if (newRows.length) {
        const { error } = await db.from("assignments").upsert(newRows, { onConflict: "subject_id,title_id" });
        if (error) throw error;
      }
      assigned = newRows.length;
      send({ phase: "assigning", done: titleIds.length, total: titleIds.length });
    }

    send({
      phase: "done", received: result.received, inserted: result.inserted,
      updated: result.skipped, assigned, alreadyAssigned: titleIds.length - assigned,
    });

    await logActivity(db, {
      userEmail: email, action: "assignment_bulk_add_printed",
      summary: `${email || "Someone"} bulk-added ${assigned} printed book${assigned === 1 ? "" : "s"} to "${subj.course_code || subj.course_title}"`
        + ` (${result.inserted} new title${result.inserted === 1 ? "" : "s"}, ${result.skipped} existing updated)`,
      detail: { subject_id: subjectId, campus, received: result.received, inserted: result.inserted, updated: result.skipped, assigned },
      batchId, revertible: result.inserted > 0,
    });
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
