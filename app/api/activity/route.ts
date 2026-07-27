import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ActivityRow = {
  id: number;
  created_at: string;
  user_email: string;
  action: string;
  summary: string;
  detail: Record<string, unknown>;
  batch_id: string | null;
  revertible: boolean;
  reverted_at: string | null;
};

const PAGE_SIZE = 100;

/** GET /api/activity — most recent activity first, capped at 100 rows.
 *  Requires sign-in (not in middleware's PUBLIC_API list). */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const before = u.searchParams.get("before"); // created_at cursor for "load more"
    const db = serviceClient();
    let q = db.from("activity_log").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE);
    if (before) q = q.lt("created_at", before);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ activity: (data ?? []) as ActivityRow[] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
