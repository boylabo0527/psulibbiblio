import { NextResponse } from "next/server";
import { RESOURCE_BY_ID, isResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const q = (u.searchParams.get("q") ?? "").trim();
    const format = u.searchParams.get("format");
    const campus = (u.searchParams.get("campus") ?? "").trim();
    const limit = Math.min(50, parseInt(u.searchParams.get("limit") ?? "20", 10));
    if (!q) return NextResponse.json({ titles: [] });
    const db = serviceClient();
    let query = db.from("titles")
      .select("id, format, title, author, publisher, year, isbn, issn, call_no, copies, campus")
      .ilike("title", `%${q}%`)
      .limit(limit);
    if (format && isResourceTypeId(format)) {
      query = query.eq("format", format);
      // Campus filter only applies to campus-scoped (printed) formats.
      if (RESOURCE_BY_ID[format].campusScoped && campus) {
        query = query.or(`campus.eq.${campus},campus.eq.`);
      }
    } else if (campus) {
      // No specific format chosen: still hide cross-campus printed copies.
      // Postgrest can't conditionally OR by row, so the client also filters
      // visually; we just narrow common case here.
      query = query.or(`campus.eq.${campus},campus.eq.`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ titles: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
