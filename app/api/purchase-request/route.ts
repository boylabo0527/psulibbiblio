import { generatePurchaseRequestXlsx } from "@/lib/exports-pr";
import type { PRData } from "@/lib/exports-pr";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["purchase-request"]?.can_edit) {
      return new Response(JSON.stringify({ error: "Your account doesn't have permission to generate purchase requests." }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    const data: PRData = await req.json();
    const buf = generatePurchaseRequestXlsx(data);
    const filename = `PR_${(data.prNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;

    // Best-effort: record the PR for the Monitoring tab. A logging failure
    // must never block the download the user is actually waiting on.
    try {
      const totalAmount = (data.items ?? []).reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      await db.from("purchase_requests").insert({
        pr_no: data.prNo || "", submitted_by: email,
        entity_name: data.entityName || "", office: data.office || "",
        fund_cluster: data.fundCluster || "", rc_code: data.rcCode || "",
        purpose: data.purpose || "", requested_by: data.requestedBy || "",
        approved_by: data.approvedBy || "", pr_date: data.date || "",
        items: data.items ?? [], total_amount: totalAmount,
      });
      await logActivity(db, {
        userEmail: email, action: "purchase_request_generate",
        summary: `${email} generated purchase request ${data.prNo || "(draft)"} — ${(data.items ?? []).length} item(s), ${totalAmount.toLocaleString()}`,
        detail: { pr_no: data.prNo ?? "", item_count: (data.items ?? []).length, total_amount: totalAmount },
      });
    } catch (logErr) {
      console.error("Failed to record purchase_requests row:", logErr);
    }
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as { message?: string })?.message ?? String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
