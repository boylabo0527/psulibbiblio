import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";
import type { ValidationRow } from "@/lib/parsers";
import { createCollectingValidateJob, appendValidateJobRows, finalizeValidateJob } from "@/lib/validate-jobs";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type ValidateChunkResponse =
  | { jobId: string; finalized: false }
  | { jobId: string; finalized: true; programsTotal: number; rowsTotal: number; unknownPrograms: string[] }
  | { error: string };

/** POST /api/validate-csv/chunk { jobId?, rows, done? } -- the chunked
 *  counterpart to /api/validate-csv/start, for a file large enough that
 *  even its rows narrowed to just the fields validation needs
 *  (course_code/program/title/isbn/verdict) don't reliably fit one
 *  request body. The client (ValidateAllProgramsAdmin.tsx) splits its
 *  parsed rows into several smaller batches and calls this once per
 *  batch, threading the jobId returned by the first call through to the
 *  rest, and sets `done: true` on the last one to trigger
 *  finalizeValidateJob -- same {jobId, programsTotal, rowsTotal,
 *  unknownPrograms} shape /start already returns, so the client's
 *  existing "kick off /continue polling" logic doesn't need to know
 *  which path produced it. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
    return NextResponse.json({ error: "Your account doesn't have permission to change assignments." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({})) as { jobId?: string; rows?: ValidationRow[]; done?: boolean };
    const jobId = body.jobId ?? (await createCollectingValidateJob(db, userEmail)).jobId;

    if (body.rows?.length) await appendValidateJobRows(db, jobId, body.rows);

    if (!body.done) {
      return NextResponse.json({ jobId, finalized: false } satisfies ValidateChunkResponse);
    }

    const { programsTotal, rowsTotal, unknownPrograms } = await finalizeValidateJob(db, jobId);
    if (!rowsTotal) {
      return NextResponse.json({ error: "No usable rows found -- need at least Course Code (or Program, for journal rows) and Title columns." }, { status: 400 });
    }
    return NextResponse.json({ jobId, finalized: true, programsTotal, rowsTotal, unknownPrograms } satisfies ValidateChunkResponse);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) } satisfies ValidateChunkResponse, { status: 500 });
  }
}
