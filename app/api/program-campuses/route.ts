import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { getUserPermissions } from "@/lib/permissions";
import { getAllowedProgramIds } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { program_id: number; campus_id: number; campuses: { name: string } | null };

/** GET — program→campus offering map: { mappings: [{ program_id, campus_id, campus_name }] }.
 *  A campus-restricted user only sees rows for their own campus(es) --
 *  consistent with /api/campuses only listing their campus(es) too. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    let allowedCampusIds: number[] | null = null;
    if (email) {
      const perms = await getUserPermissions(db, email);
      allowedCampusIds = perms.campusIds;
    }
    const rows = await pageThrough<Row>(
      (from, to) => {
        let q = db.from("program_campuses").select("program_id, campus_id, campuses(name)").range(from, to);
        if (allowedCampusIds) q = q.in("campus_id", allowedCampusIds.length ? allowedCampusIds : [-1]);
        return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
      },
    );
    const mappings = rows
      .filter((r) => r.campuses?.name)
      .map((r) => ({ program_id: r.program_id, campus_id: r.campus_id, campus_name: r.campuses!.name }));
    return NextResponse.json({ mappings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}

/** PUT — set which campuses offer a program.
 *  Body: { program_id: number, campus_ids: number[] }.
 *
 *  Unrestricted callers replace the program's FULL campus list in one
 *  shot (existing behavior). A campus-restricted caller's UI only shows
 *  their own campus's checkbox, so it can never submit a complete list for
 *  a program shared across campuses -- honoring "replace the full set"
 *  from a partial view would silently wipe out other campuses' offerings.
 *  For a restricted caller this instead only adds/removes rows within
 *  their own allowed campus(es), leaving every other campus's assignment
 *  for this program untouched. */
export async function PUT(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["campus-validation"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to change campus offerings." }, { status: 403 });
    }
    const body = await req.json() as { program_id?: number; campus_ids?: number[] };
    const programId = body.program_id;
    const campusIds = body.campus_ids ?? [];
    if (!Number.isFinite(programId)) {
      return NextResponse.json({ error: "program_id is required" }, { status: 400 });
    }

    if (perms.campusIds !== null) {
      const allowedProgramIds = await getAllowedProgramIds(db, perms.campusIds);
      const outOfScope = campusIds.filter((id) => !perms.campusIds!.includes(id));
      if (outOfScope.length) {
        return NextResponse.json({ error: "You can only set campus offerings within your own assigned campus(es)." }, { status: 403 });
      }
      if (!allowedProgramIds.has(programId as number) && campusIds.length === 0) {
        // Program isn't currently offered at any of the caller's campuses,
        // and they're not adding one -- nothing in scope to do.
        return NextResponse.json({ error: "This program isn't offered at any of your assigned campuses." }, { status: 403 });
      }
      const { error: delErr } = await db.from("program_campuses")
        .delete().eq("program_id", programId as number).in("campus_id", perms.campusIds);
      if (delErr) throw delErr;
      if (campusIds.length) {
        const rows = campusIds.map((campus_id) => ({ program_id: programId, campus_id }));
        const { error: insErr } = await db.from("program_campuses").insert(rows);
        if (insErr) throw insErr;
      }
      return NextResponse.json({ ok: true });
    }

    const { error: delErr } = await db.from("program_campuses").delete().eq("program_id", programId as number);
    if (delErr) throw delErr;
    if (campusIds.length) {
      const rows = campusIds.map((campus_id) => ({ program_id: programId, campus_id }));
      const { error: insErr } = await db.from("program_campuses").insert(rows);
      if (insErr) throw insErr;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
