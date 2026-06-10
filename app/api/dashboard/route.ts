import { NextResponse } from "next/server";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = serviceClient();
    const [
      { count: programs },
      { count: subjects },
      { count: titles },
      { count: assignments },
    ] = await Promise.all([
      db.from("programs").select("*", { count: "exact", head: true }),
      db.from("subjects").select("*", { count: "exact", head: true }),
      db.from("titles").select("*", { count: "exact", head: true }),
      db.from("assignments").select("*", { count: "exact", head: true }),
    ]);

    const byType = {} as Record<ResourceTypeId, number>;
    await Promise.all(RESOURCE_TYPES.map(async (t) => {
      const { count } = await db.from("titles").select("*", { count: "exact", head: true }).eq("format", t.id);
      byType[t.id] = count ?? 0;
    }));

    return NextResponse.json({
      totals: {
        programs: programs ?? 0,
        subjects: subjects ?? 0,
        titles: titles ?? 0,
        assignments: assignments ?? 0,
        byType,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
