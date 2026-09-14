import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import { parseValidationRows } from "@/lib/parsers";
import { createValidateJob } from "@/lib/validate-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type ValidateStartResponse =
  | { jobId: string; programsTotal: number; unknownPrograms: string[] }
  | { error: string };

/** POST /api/validate-csv/start -- multipart/form-data with `file`, the
 *  system-wide counterpart to /api/programs/validate-csv: instead of
 *  checking one chosen program, this reads every row's own Program column
 *  (see programBibliographyCsv) and checks/queues work for every program
 *  the file actually mentions, in the background (see lib/validate-jobs.ts
 *  for why -- checking N programs, each its own handful of Supabase round
 *  trips, doesn't reliably fit one request). Call /api/validate-csv/
 *  continue with the returned jobId to make it progress. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });

    const rows = await parseValidationRows(file.name, Buffer.from(await file.arrayBuffer()));
    if (!rows.length) {
      return NextResponse.json({ error: "No usable rows found -- need at least Course Code (or Program, for journal rows) and Title columns." }, { status: 400 });
    }

    const { jobId, programsTotal, unknownPrograms } = await createValidateJob(db, rows, userEmail);
    return NextResponse.json({ jobId, programsTotal, unknownPrograms } satisfies ValidateStartResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) } satisfies ValidateStartResponse, { status: 500 });
  }
}
