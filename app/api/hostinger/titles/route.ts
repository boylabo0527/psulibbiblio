import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { hostingerEnabled, searchPerlegoTitles, countPerlegoTitles } from "@/lib/hostinger-mysql";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/** GET /api/hostinger/titles?q=...&page=... -- searches the eBook titles
 *  moved out to Hostinger MySQL (see lib/hostinger-mysql.ts and the
 *  Migrate Unmatched eBooks admin tool). Admin-only, since it uses
 *  org-wide database credentials rather than a per-tab permission. */
export async function GET(req: Request) {
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmailFromRequest(req));
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can view this." }, { status: 403 });
  }
  if (!hostingerEnabled()) {
    return NextResponse.json({
      error: "Hostinger isn't configured yet -- set HOSTINGER_DB_HOST, HOSTINGER_DB_NAME, HOSTINGER_DB_USER, and HOSTINGER_DB_PASSWORD in Vercel's project settings.",
    }, { status: 400 });
  }

  const u = new URL(req.url);
  const q = u.searchParams.get("q") ?? "";
  const page = Math.max(1, parseInt(u.searchParams.get("page") ?? "1", 10) || 1);

  try {
    const [result, totalArchived] = await Promise.all([
      searchPerlegoTitles(q, page, PAGE_SIZE),
      countPerlegoTitles(),
    ]);
    return NextResponse.json({
      rows: result.rows,
      total: result.total,
      totalArchived,
      page, pageSize: PAGE_SIZE,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
