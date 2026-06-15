import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { rows, canvass_date } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows array is required" }, { status: 400 });
    }
    const db = serviceClient();
    const inserts = rows.map((r: Record<string, unknown>) => ({
      title: String(r.title ?? "").trim(),
      author: String(r.author ?? "").trim() || null,
      publisher: String(r.publisher ?? "").trim() || null,
      year: String(r.year ?? "").trim() || null,
      isbn: String(r.isbn ?? "").trim() || null,
      supplier: String(r.supplier ?? "").trim() || null,
      unit: String(r.unit ?? "copy").trim() || "copy",
      stock_prop_no: String(r.stock_prop_no ?? "").trim() || null,
      unit_cost: Number(r.unit_cost ?? 0),
      quantity: Math.max(1, Number(r.quantity ?? 1)),
      notes: String(r.notes ?? "").trim() || null,
      canvass_date: (canvass_date as string) || null,
      program_id: null,
      subject_id: null,
    })).filter(r => r.title !== "");

    const { error, count } = await db.from("canvassing").insert(inserts, { count: "exact" });
    if (error) throw error;
    return NextResponse.json({ inserted: count ?? inserts.length });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
