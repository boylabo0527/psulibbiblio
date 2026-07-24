import { parseSubjects, buildSubjectRowsFromRaw, type ParsedSubject } from "@/lib/parsers";
import { pageThrough } from "@/lib/paging";
import { ndjsonStream } from "@/lib/streaming";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH = 500;

export async function POST(req: Request) {
  // Accept either pre-parsed JSON rows (sent by the browser after client-side
  // spreadsheet parsing) or a raw file via multipart/form-data.
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  let programOverride = "";
  let preRows: Record<string, string>[] | null = null;
  let file: File | null = null;

  if (isJson) {
    const body = await req.json() as { rows: Record<string, string>[]; filename?: string; program?: string };
    preRows = body.rows ?? [];
    programOverride = (body.program ?? "").trim();
    file = { name: body.filename ?? "upload.xlsx" } as File;
  } else {
    const form = await req.formData();
    file = form.get("file") as File | null;
    programOverride = ((form.get("program") as string | null) ?? "").trim();
  }

  const userEmail = userEmailFromRequest(req);
  const perms = await getUserPermissions(serviceClient(), userEmail);
  if (!perms.isAdmin && !perms.tabs["upload"]?.can_edit) {
    return new Response(JSON.stringify({ error: "Your account doesn't have permission to upload." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const batchId = randomUUID();

  const stream = ndjsonStream(async (send) => {
    const db = serviceClient();
    try {
    if (!file) throw new Error("Missing file");
    send({ phase: "parsing" });
    const records: ParsedSubject[] = preRows
      ? buildSubjectRowsFromRaw(preRows)
      : await parseSubjects(file.name, Buffer.from(await (file as File).arrayBuffer()));
    send({ phase: "parsed", total: records.length });
    if (!records.length) {
      send({ phase: "done", received: 0, inserted: 0, skipped: 0, programs: 0 });
      return;
    }

    // Dedup against existing subjects keyed by (program_id, course_code, course_title).
    const existing = await pageThrough<{ program_id: number; course_code: string; course_title: string }>(
      (from, to) => db.from("subjects")
        .select("program_id, course_code, course_title")
        .range(from, to) as unknown as PromiseLike<{ data: { program_id: number; course_code: string; course_title: string }[] | null; error: { message: string } | null }>,
      (count) => send({ phase: "deduping", existing: count }),
    );
    send({ phase: "deduping", existing: existing.length });
    const seen = new Set(existing.map((e) => `${e.program_id}|${e.course_code}|${e.course_title}`));

    const programCache = new Map<string, number>();
    let programsCreated = 0;

    const resolveProgram = async (progName: string): Promise<number> => {
      const cached = programCache.get(progName);
      if (cached) return cached;
      const existing = await db.from("programs")
        .select("id").eq("name", progName).maybeSingle();
      let pid: number;
      if (existing.data?.id) {
        pid = existing.data.id as number;
      } else {
        const created = await db.from("programs")
          .insert({ name: progName }).select("id").single();
        if (created.error) throw created.error;
        pid = created.data.id as number;
        programsCreated++;
      }
      programCache.set(progName, pid);
      return pid;
    };

    type Ready = { program_id: number; course_code: string; course_title: string; description: string; sort_order: number; batch_id: string };
    const ready: Ready[] = [];
    let skipped = 0;
    for (const rec of records) {
      const progName = (programOverride || rec.program || "").trim();
      if (!progName) {
        throw new Error("No 'program' column found and no program override provided.");
      }
      const pid = await resolveProgram(progName);
      const dedupKey = `${pid}|${rec.course_code ?? ""}|${rec.course_title}`;
      if (seen.has(dedupKey)) { skipped++; continue; }
      seen.add(dedupKey);
      ready.push({
        program_id: pid,
        course_code: rec.course_code ?? "",
        course_title: rec.course_title,
        description: rec.description ?? "",
        sort_order: rec.sort_order ?? 0,
        batch_id: batchId,
      });
    }
    send({ phase: "inserting", inserted: 0, skipped, total: records.length });

    let inserted = 0;
    for (let i = 0; i < ready.length; i += BATCH) {
      const slice = ready.slice(i, i + BATCH);
      const { data, error } = await db.from("subjects").insert(slice).select("id");
      if (error) throw error;
      inserted += data?.length ?? 0;
      send({ phase: "inserting", inserted, skipped, total: records.length });
    }
    send({ phase: "done", received: records.length, inserted, skipped, programs: programsCreated });
    await logActivity(db, {
      userEmail, action: "upload_subjects",
      summary: `Uploaded subjects: ${inserted} new, ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped${programsCreated ? `, ${programsCreated} new program${programsCreated === 1 ? "" : "s"} created` : ""}`,
      detail: { received: records.length, inserted, skipped, programsCreated },
      batchId, revertible: inserted > 0,
    });
    } catch (err) {
      await logActivity(db, {
        userEmail, action: "upload_subjects",
        summary: `Subjects upload FAILED: ${err instanceof Error ? err.message : String(err)}`,
        detail: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
