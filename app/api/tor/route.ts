import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { errorMessage } from "@/lib/errors";
import { generateTorDocx, type TorItem } from "@/lib/exports-tor";
import type { PersistedPRItem } from "@/lib/purchase-request-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type TorMatchedItem = {
  key: string; // synthetic id ("<pr_id>-<index>") -- these aren't their own DB rows
  particulars: string;
  oum: string;
  quantity: number;
  unit_cost: number;
  supplier: string;
  program: string;
  pr_no: string;
  campus: string;
};

/** GET /api/tor -- Purchase Request line items matching any combination of
 *  ?supplier=&campus=&program=&fund_source= (all optional; given filters
 *  AND together, an unset filter matches everything). This is what feeds
 *  the "II. LIST OF SUPPLIES AND MATERIALS" table when generating a TOR --
 *  a supplier/campus/program/fund-source scoped subset of what's already
 *  been requested, not a fresh selection process of its own. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const perms = await getUserPermissions(db, userEmailFromRequest(req));
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const u = new URL(req.url);
    const supplierFilter = u.searchParams.get("supplier") || "";
    const campusFilter = u.searchParams.get("campus") || "";
    const programFilter = u.searchParams.get("program") || "";
    const fundSourceFilter = u.searchParams.get("fund_source") || "";

    let q = db.from("purchase_requests").select("id, pr_no, items, campus, campus_id, fund_source, total_amount").neq("status", "cancelled");
    if (perms.campusIds !== null) {
      q = q.or(`campus_id.is.null,campus_id.in.(${perms.campusIds.join(",") || "-1"})`);
    }
    if (campusFilter) q = q.eq("campus", campusFilter);
    if (fundSourceFilter) q = q.eq("fund_source", fundSourceFilter);

    const { data, error } = await q;
    if (error) throw error;

    const items: TorMatchedItem[] = [];
    const campusesSeen = new Set<string>();
    for (const pr of data ?? []) {
      const prItems = (Array.isArray(pr.items) ? pr.items : []) as PersistedPRItem[];
      prItems.forEach((item, i) => {
        if (supplierFilter && item.supplier !== supplierFilter) return;
        if (programFilter && item.program !== programFilter) return;
        items.push({
          key: `${pr.id}-${i}`,
          particulars: item.description, oum: item.unit, quantity: item.quantity, unit_cost: item.unit_cost,
          supplier: item.supplier || "", program: item.program || "",
          pr_no: pr.pr_no || "(draft)", campus: pr.campus || "",
        });
        if (pr.campus) campusesSeen.add(pr.campus);
      });
    }

    const abc = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
    const proponent = campusFilter || (campusesSeen.size === 1 ? Array.from(campusesSeen)[0] : campusesSeen.size > 1 ? "Multiple Campuses" : "University-wide");

    return NextResponse.json({
      items,
      suggested: { abc, proponent, sourceOfFund: fundSourceFilter },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

type TorRequestBody = {
  projectTitle?: string; abc?: number; sourceOfFund?: string; proponent?: string;
  preparedByName?: string; preparedByTitle?: string; deliveryDays?: string;
  items?: TorItem[];
};

/** POST /api/tor -- generates the actual TOR .docx from whatever header
 *  fields and item list the caller supplies (the GET above is just a
 *  starting point -- items can be trimmed/edited client-side before this
 *  is called, same relationship as PR/PO generation have to their
 *  consolidated starting lists). */
export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_edit) {
      return NextResponse.json({ error: "Your account doesn't have permission to generate a Terms of Reference." }, { status: 403 });
    }

    const body: TorRequestBody = await req.json();
    const items = (body.items ?? []).filter((i) => i.particulars?.trim());
    if (!items.length) return NextResponse.json({ error: "At least one item is required." }, { status: 400 });
    const projectTitle = (body.projectTitle ?? "").trim() || "Procurement of Textbooks and Other Library Reading Materials";

    const buf = await generateTorDocx({
      projectTitle,
      abc: Number(body.abc) || 0,
      sourceOfFund: (body.sourceOfFund ?? "").trim(),
      proponent: (body.proponent ?? "").trim(),
      preparedByName: (body.preparedByName ?? "").trim(),
      preparedByTitle: (body.preparedByTitle ?? "").trim(),
      deliveryDays: (body.deliveryDays ?? "").trim(),
      items,
    });

    await logActivity(db, {
      userEmail: email, action: "tor_generate",
      summary: `${email} generated a Terms of Reference: "${projectTitle}" (${items.length} item(s))`,
      detail: { project_title: projectTitle, item_count: items.length },
    });

    const filename = `TOR_${projectTitle.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}.docx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
