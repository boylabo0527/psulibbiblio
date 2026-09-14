import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { parseValidationRows, type ValidationRow } from "@/lib/parsers";
import { createValidateJob } from "@/lib/validate-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type ValidateStartResponse =
  | { jobId: string; programsTotal: number; unknownPrograms: string[] }
  | { error: string };

/** POST /api/validate-csv/start -- the system-wide counterpart to
 *  /api/programs/validate-csv: instead of checking one chosen program,
 *  this reads every row's own Program column (see programBibliographyCsv)
 *  and checks/queues work for every program the file actually mentions,
 *  in the background (see lib/validate-jobs.ts for why -- checking N
 *  programs, each its own handful of Supabase round trips, doesn't
 *  reliably fit one request). Call /api/validate-csv/continue with the
 *  returned jobId to make it progress.
 *
 *  Accepts either multipart/form-data with `file` (a moderate single-
 *  program file), or a JSON body { rows } of already-narrowed
 *  ValidationRow objects -- same dual-mode acceptance as /api/upload/
 *  [type], for the same reason: an export covering every program can run
 *  large enough in its full multi-column form to land close to (or over)
 *  a serverless function's request body limit, so ValidateAllPrograms-
 *  Admin parses it client-side and narrows it (see lib/parse-client.ts's
 *  buildValidationRowsFromRaw) to just these fields before sending it. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
  }

  try {
    const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
    let rows: ValidationRow[];
    if (isJson) {
      const body = await req.json() as { rows?: ValidationRow[] };
      rows = body.rows ?? [];
    } else {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
      rows = await parseValidationRows(file.name, Buffer.from(await file.arrayBuffer()));
    }
    if (!rows.length) {
      return NextResponse.json({ error: "No usable rows found -- need at least Course Code (or Program, for journal rows) and Title columns." }, { status: 400 });
    }

    const { jobId, programsTotal, unknownPrograms } = await createValidateJob(db, rows, userEmail);
    return NextResponse.json({ jobId, programsTotal, unknownPrograms } satisfies ValidateStartResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) } satisfies ValidateStartResponse, { status: 500 });
  }
}
