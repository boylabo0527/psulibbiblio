import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { isProgramInScope } from "@/lib/campus-scope";
import { userEmailFromRequest } from "@/lib/activity";
import { loadProgramBibliography } from "@/lib/bibliography";
import { isResourceTypeId, type ResourceTypeId } from "@/lib/resources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id, 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Bad program id" }, { status: 400 });
    }

    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }
    if (!(await isProgramInScope(db, perms, id))) {
      return NextResponse.json({ error: "This program isn't offered at any of your assigned campuses." }, { status: 403 });
    }

    const u = new URL(req.url);
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const minYear = parseInt(u.searchParams.get("from_year") ?? "", 10);
    const maxYear = parseInt(u.searchParams.get("to_year") ?? "", 10);
    // Presence of the param (even empty) means "filter to exactly this set,
    // possibly none" -- distinct from omitting it entirely, which means no
    // filtering at all (every resource type included, the old default).
    const types: ResourceTypeId[] | undefined = u.searchParams.has("types")
      ? (u.searchParams.get("types") ?? "").split(",").filter(isResourceTypeId)
      : undefined;
    const data = await loadProgramBibliography(
      id, campus, undefined,
      Number.isFinite(minYear) ? minYear : undefined,
      Number.isFinite(maxYear) ? maxYear : undefined,
      types,
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) },
      { status: 500 },
    );
  }
}
