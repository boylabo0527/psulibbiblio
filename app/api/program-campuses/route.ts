import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { pageThrough } from "@/lib/paging";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { program_id: number; campus_id: number; campuses: { name: string } | null };

/** GET — full program→campus offering map: { mappings: [{ program_id, campus_id, campus_name }] } */
export async function GET() {
  try {
    const db = serviceClient();
    const rows = await pageThrough<Row>(
      (from, to) => db.from("program_campuses")
        .select("program_id, campus_id, campuses(name)")
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
    );
    const mappings = rows
      .filter((r) => r.campuses?.name)
      .map((r) => ({ program_id: r.program_id, campus_id: r.campus_id, campus_name: r.campuses!.name }));
    return NextResponse.json({ mappings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}

/** PUT — replace the full set of campuses offering a program.
 *  Body: { program_id: number, campus_ids: number[] } */
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
