import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";
import { loadProgramBibliography } from "@/lib/bibliography";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/programs/[id]/journals -- public (see middleware.ts), unlike
 *  /api/programs/[id]/bibliography which also returns full per-course book
 *  detail and deliberately stays behind sign-in. ProgramJournalsPanel is
 *  shown on the public Dashboard/Procurement Analysis tabs, so it needs a
 *  route it can actually call signed out -- this is a narrow slice of
 *  loadProgramBibliography exposing just a program's journal subscriptions
 *  (program-wide, not tied to any one course), never its books/courses.
 *
 *  A signed-in, campus-restricted user still only sees programs in their
 *  own scope; an anonymous visitor (the normal case here) gets every
 *  program, same permissiveness as /api/dashboard/subjects. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    if (email) {
      const perms = await getUserPermissions(db, email);
      if (!(await isProgramInScope(db, perms, id))) {
        return NextResponse.json({ error: "This program isn't offered at any of your assigned campuses." }, { status: 403 });
      }
    }

    const u = new URL(req.url);
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const data = await loadProgramBibliography(id, campus);
    return NextResponse.json({ journals: data.journals });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) },
      { status: 500 },
    );
  }
}
