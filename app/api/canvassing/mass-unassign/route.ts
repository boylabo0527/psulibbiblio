import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 25;

/** POST /api/canvassing/mass-unassign -- body { ids: number[] }. Batched
 *  counterpart to the per-row "Unmatch" button (/api/canvassing/assign with
 *  subject_id: null): clears each row's course assignment and validation,
 *  sending it back to the unassigned/needs-sourcing pool, without deleting
 *  the canvassing record itself -- used by CanvassingTab's "Mass Remove"
 *  bulk action on the assigned table. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change canvassing assignments." }, { status: 403 });
    }
    const body = await req.json() as { ids?: number[] };
    const ids = Array.from(new Set((body.ids ?? []).map(Number).filter(Number.isFinite)));
    if (!ids.length) {
      return NextResponse.json({ error: "ids array is required." }, { status: 400 });
    }

    const { data: existingRows } = await db.from("canvassing").select("id, program_id").in("id", ids);
    const allowedProgramIds = perms.campusIds !== null ? await getAllowedProgramIds(db, perms.campusIds) : null;
    const inScope = (programId: number | null) => allowedProgramIds === null || programId == null || allowedProgramIds.has(programId);
    const toApply = (existingRows ?? []).filter((r) => inScope(r.program_id as number | null)).map((r) => r.id as number);

    for (let i = 0; i < toApply.length; i += BATCH) {
      const chunk = toApply.slice(i, i + BATCH);
      const { error } = await db.from("canvassing")
        .update({ subject_id: null, program_id: null, validated: false })
        .in("id", chunk);
      if (error) throw error;
      await db.from("canvassing_subjects").delete().in("canvassing_id", chunk);
    }

    if (toApply.length) {
      await logActivity(db, {
        userEmail: email, action: "canvassing_mass_unassign",
        summary: `${email} unassigned ${toApply.length} canvassing ${toApply.length === 1 ? "entry" : "entries"}`,
        detail: { ids: toApply },
      });
    }

    return NextResponse.json({ unassigned: toApply.length, skipped: ids.length - toApply.length });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
