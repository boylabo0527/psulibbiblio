import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = serviceClient();
    const [{ count: programs }, { count: subjects }, { count: titles }, { count: assignments }] = await Promise.all([
      db.from("programs").select("*", { count: "exact", head: true }),
      db.from("subjects").select("*", { count: "exact", head: true }),
      db.from("titles").select("*", { count: "exact", head: true }),
      db.from("assignments").select("*", { count: "exact", head: true }),
    ]);
    const [{ count: ebooks }, { count: printed }] = await Promise.all([
      db.from("titles").select("*", { count: "exact", head: true }).eq("format", "ebook"),
      db.from("titles").select("*", { count: "exact", head: true }).eq("format", "printed"),
    ]);
    return NextResponse.json({
      totals: {
        programs: programs ?? 0,
        subjects: subjects ?? 0,
        titles: titles ?? 0,
        ebooks: ebooks ?? 0,
        printed: printed ?? 0,
        assignments: assignments ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
