import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["canvassing"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to add canvassing records." }, { status: 403 });
    }
    const { rows, canvass_date } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows array is required" }, { status: 400 });
    }
    const inserts = rows.map((r: Record<string, unknown>) => {
      const itemType = r.item_type === "journal" ? "journal" : "book";
      const manilaPrice = Number(r.manila_price);
      const provincialPrice = Number(r.provincial_price);
      // A journal's working unit cost is always its provincial price --
      // PSU is a provincial campus, so that's what's actually paid; Manila
      // price is kept only as a reference figure, never used downstream.
      const unitCost = itemType === "journal" && Number.isFinite(provincialPrice) && provincialPrice > 0
        ? provincialPrice
        : Number(r.unit_cost ?? 0);
      return {
        title: String(r.title ?? "").trim(),
        author: String(r.author ?? "").trim() || null,
        publisher: String(r.publisher ?? "").trim() || null,
        year: String(r.year ?? "").trim() || null,
        isbn: String(r.isbn ?? "").trim() || null,
        supplier: String(r.supplier ?? "").trim() || null,
        unit: String(r.unit ?? "copy").trim() || "copy",
        stock_prop_no: String(r.stock_prop_no ?? "").trim() || null,
        unit_cost: unitCost,
        quantity: Math.max(1, Number(r.quantity ?? 1)),
        notes: String(r.notes ?? "").trim() || null,
        canvass_date: (canvass_date as string) || null,
        program_id: null,
        subject_id: null,
        item_type: itemType,
        subject_area: String(r.subject_area ?? "").trim() || null,
        issue: String(r.issue ?? "").trim() || null,
        manila_price: Number.isFinite(manilaPrice) && manilaPrice > 0 ? manilaPrice : null,
        provincial_price: Number.isFinite(provincialPrice) && provincialPrice > 0 ? provincialPrice : null,
      };
    }).filter(r => r.title !== "");

    const { error, count } = await db.from("canvassing").insert(inserts, { count: "exact" });
    if (error) throw error;
    return NextResponse.json({ inserted: count ?? inserts.length });
  } catch (err) {
    return NextResponse.json({ error: (err as { message?: string })?.message ?? String(err) }, { status: 500 });
  }
}
