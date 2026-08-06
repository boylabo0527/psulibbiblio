import { generatePurchaseRequestXlsx } from "@/lib/exports-pr";
import type { PRData } from "@/lib/exports-pr";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest, logActivity } from "@/lib/activity";
import { getClaimedCanvassingIds, type PersistedPRItem } from "@/lib/purchase-request-items";
import { isCampusInScope } from "@/lib/campus-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What PurchaseRequestTab actually sends: PRData's items, but with
// supplier/program/canvassing_id carried along per line too --
// generatePurchaseRequestXlsx only reads the PRItem fields (extra
// properties are just ignored there); the extras are what let Monitoring
// consolidate by supplier/program and what the duplicate check below keys on.
type IncomingPRData = Omit<PRData, "items"> & { items: PersistedPRItem[]; campus?: string; campus_id?: number | null; fundSource?: string };

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
    const data: IncomingPRData = await req.json();

    if (!isCampusInScope(perms, data.campus_id ?? null)) {
      return new Response(JSON.stringify({ error: "You can only generate purchase requests for your assigned campus(es)." }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }

    // Duplicate prevention -- checked before anything is generated or
    // saved, so a rejected request never produces a half-done download.
    const prNo = (data.prNo ?? "").trim();
    if (prNo) {
      const { data: dupe } = await db.from("purchase_requests").select("id, status").eq("pr_no", prNo).neq("status", "cancelled").maybeSingle();
      if (dupe) {
        return new Response(JSON.stringify({ error: `PR No. "${prNo}" already exists (status: ${dupe.status}). Use a different PR No., or cancel/modify the existing one from Monitoring.` }), {
          status: 409, headers: { "Content-Type": "application/json" },
        });
      }
    }
    const requestedCanvassingIds = (data.items ?? []).map((i) => i.canvassing_id).filter((id): id is number => id != null);
    if (requestedCanvassingIds.length) {
      const claimed = await getClaimedCanvassingIds(db);
      const conflicts = (data.items ?? []).filter((i) => i.canvassing_id != null && claimed.has(i.canvassing_id));
      if (conflicts.length) {
        const names = conflicts.map((i) => `"${i.description}" (already in ${claimed.get(i.canvassing_id!)!.pr_no || "an existing PR"})`).join(", ");
        return new Response(JSON.stringify({ error: `${conflicts.length} title(s) are already on another active purchase request: ${names}. Reload the item list, or cancel that PR first.` }), {
          status: 409, headers: { "Content-Type": "application/json" },
        });
      }
    }

    const buf = generatePurchaseRequestXlsx(data);
    const filename = `PR_${(data.prNo || "draft").replace(/[^A-Za-z0-9_-]/g, "_")}.xlsx`;

    // Best-effort: record the PR for the Monitoring tab. A logging failure
    // must never block the download the user is actually waiting on.
    try {
      const totalAmount = (data.items ?? []).reduce((s, i) => s + i.quantity * i.unit_cost, 0);
      const { data: firstStep } = await db.from("pr_workflow_steps").select("seq, office_name").order("seq").limit(1).maybeSingle();
      const { data: inserted } = await db.from("purchase_requests").insert({
        pr_no: data.prNo || "", submitted_by: email,
        entity_name: data.entityName || "", office: data.office || "",
        fund_cluster: data.fundCluster || "", rc_code: data.rcCode || "",
        purpose: data.purpose || "", requested_by: data.requestedBy || "",
        approved_by: data.approvedBy || "", pr_date: data.date || "",
        items: data.items ?? [], total_amount: totalAmount,
        campus: data.campus || "", campus_id: data.campus_id ?? null,
        fund_source: data.fundSource || "",
        current_step_seq: firstStep?.seq ?? null,
      }).select("id").single();
      let firstHistoryId: number | null = null;
      if (inserted && firstStep) {
        const { data: histRow } = await db.from("pr_step_history").insert({
          purchase_request_id: inserted.id, seq: firstStep.seq,
          office_name: firstStep.office_name, moved_by: email,
        }).select("id").single();
        firstHistoryId = histRow?.id ?? null;
      }
      await logActivity(db, {
        userEmail: email, action: "purchase_request_generate",
        summary: `${email} generated purchase request ${data.prNo || "(draft)"} — ${(data.items ?? []).length} item(s), ${totalAmount.toLocaleString()}`,
        detail: {
          pr_no: data.prNo ?? "", item_count: (data.items ?? []).length, total_amount: totalAmount,
          purchase_request_id: inserted?.id ?? null, history_id: firstHistoryId,
        },
        revertible: !!inserted,
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
