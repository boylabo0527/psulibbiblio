import { parseEbookTitles, parseJournals, parsePrintedBooks, buildTitleRowsFromRaw } from "@/lib/parsers";
import { ndjsonStream } from "@/lib/streaming";
import { RESOURCE_BY_ID, isResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";
import type { TitleRow } from "@/lib/types";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { ingestTitleRecords } from "@/lib/ingest-titles";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { type: string } }) {
  // Accept either pre-parsed JSON rows (sent by the browser after client-side
  // spreadsheet parsing) or a raw file via multipart/form-data.
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");

  let campusInput = "";
  let preRows: Record<string, string>[] | null = null;
  let file: File | null = null;

  if (isJson) {
    const body = await req.json() as { rows: Record<string, string>[]; filename?: string; campus?: string };
    preRows = body.rows ?? [];
    campusInput = (body.campus ?? "").trim();
    // Create a dummy filename for format detection in buildTitleRowsFromRaw
    file = { name: body.filename ?? "upload.xlsx" } as File;
  } else {
    const form = await req.formData();
    file = form.get("file") as File | null;
    campusInput = ((form.get("campus") as string | null) ?? "").trim();
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
      if (!isResourceTypeId(params.type)) {
        throw new Error(`Unknown resource type: ${params.type}`);
      }
      const rt = RESOURCE_BY_ID[params.type];
      if (!file) throw new Error("Missing file");
      const defaultCampus = rt.campusScoped ? campusInput : "";
      send({ phase: "parsing" });

      let records: TitleRow[];
      if (preRows) {
        // Client already parsed the spreadsheet; just apply column aliases.
        records = buildTitleRowsFromRaw(file.name, preRows, rt);
      } else {
        const buf = Buffer.from(await (file as File).arrayBuffer());
        if (rt.kind === "journal") {
          records = await parseJournals(file.name, buf);
        } else if (rt.medium === "print") {
          records = await parsePrintedBooks(file.name, buf);
        } else {
          records = await parseEbookTitles(file.name, buf);
        }
      }
      send({ phase: "parsed", total: records.length });
      if (!records.length) {
        send({ phase: "done", received: 0, inserted: 0, skipped: 0 });
        return;
      }

      const result = await ingestTitleRecords(db, rt, records, batchId, send, defaultCampus);
      send({ phase: "done", ...result });
      await logActivity(db, {
        userEmail, action: "upload_titles",
        summary: result.duplicates != null
          ? `Uploaded ${rt.uiLabel}: ${result.inserted} new, ${result.skipped} updated, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped`
          : `Uploaded ${rt.uiLabel}: ${result.inserted} new, ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped`,
        detail: { format: rt.id, ...result },
        batchId, revertible: result.inserted > 0,
      });
    } catch (err) {
      await logActivity(db, {
        userEmail, action: "upload_titles",
        summary: `Upload FAILED for ${params.type}: ${err instanceof Error ? err.message : String(err)}`,
        detail: { type: params.type, error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
