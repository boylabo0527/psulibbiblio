import { NextResponse } from "next/server";
import { RESOURCE_BY_ID, RESOURCE_TYPES, isResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NON_CAMPUS_SCOPED_FORMATS = RESOURCE_TYPES.filter((t) => !t.campusScoped).map((t) => t.id);

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
        query = query.eq("campus", campus);
      }
    } else if (campus) {
      // No specific format chosen: still hide cross-campus printed copies.
      // Digital formats aren't campus-scoped, so they're never filtered
      // here regardless of their campus value -- only rows actually tagged
      // with a different campus are excluded.
      query = query.or(`format.in.(${NON_CAMPUS_SCOPED_FORMATS.join(",")}),campus.eq.${campus}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ titles: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err)) }, { status: 500 });
  }
}
