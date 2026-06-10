import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const q = (u.searchParams.get("q") ?? "").trim();
    const format = u.searchParams.get("format");
    const limit = Math.min(50, parseInt(u.searchParams.get("limit") ?? "20", 10));
    if (!q) return NextResponse.json({ titles: [] });
    const db = serviceClient();
    let query = db.from("titles")
      .select("id, format, title, author, publisher, year, isbn, call_no, copies")
      .ilike("title", `%${q}%`)
      .limit(limit);
    if (format === "ebook" || format === "printed") query = query.eq("format", format);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ titles: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
