import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { mergeTitles, type MergeableTitle } from "@/lib/merge-titles";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/titles/merge — manually combine two titles the user has
 *  identified as duplicates (e.g. a minor typo in author/title/call no.)
 *  without needing to edit one to force an exact match. Body:
 *  { source_id, target_id }. Both must share a format. Copies are summed
 *  onto whichever row is older, assignments move over, the other is deleted. */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["programs"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to combine titles." }, { status: 403 });
    }
    const body = await req.json() as { source_id?: number; target_id?: number };
    const sourceId = body.source_id;
    const targetId = body.target_id;
    if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
      return NextResponse.json({ error: "source_id and target_id are required" }, { status: 400 });
    }
    if (sourceId === targetId) {
      return NextResponse.json({ error: "source_id and target_id must differ" }, { status: 400 });
    }
    const { data: rows, error } = await db.from("titles")
      .select("id, format, call_no, title, author, campus, copies")
      .in("id", [sourceId, targetId]);
    if (error) throw error;
    if (!rows || rows.length !== 2) {
      return NextResponse.json({ error: "One or both titles were not found" }, { status: 404 });
    }
    const [a, b] = rows as MergeableTitle[];
    if (a.format !== b.format) {
      return NextResponse.json({ error: "Titles must be the same resource type to combine" }, { status: 400 });
    }

    const merged = await mergeTitles(db, a, b);
    await logActivity(db, {
      userEmail: userEmailFromRequest(req), action: "title_merge",
      summary: `Combined title "${a.title}" into "${b.title}"`,
      detail: { source_id: sourceId, target_id: targetId },
    });
    return NextResponse.json({ title: merged });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
