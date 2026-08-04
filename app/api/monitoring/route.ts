import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { getUserPermissions } from "@/lib/permissions";
import { userEmailFromRequest } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OVERDUE_DAYS = 15;

export type PurchaseRequestRow = {
  id: number;
  pr_no: string;
  submitted_by: string;
  office: string;
  purpose: string;
  campus: string;
  item_count: number;
  total_amount: number;
  created_at: string;
  current_step_seq: number | null;
  current_office: string | null;
  step_entered_at: string | null;
  days_in_step: number | null;
  overdue: boolean;
  status: "in_progress" | "completed";
};

export type WorkflowStep = { id: number; seq: number; office_name: string };

export type SupplierSummaryRow = {
  supplier: string;
  item_count: number;
  total_amount: number;
  programs: string[];
  campuses: string[];
};

export type ProgramSummaryRow = {
  program: string;
  item_count: number;
  total_amount: number;
  campuses: string[];
};

export type CampusBudgetRow = {
  campus_id: number;
  campus_name: string;
  period: string;
  amount: number;
  spent: number;
  remaining: number;
  over: boolean;
};

type ItemLine = { quantity?: number; unit_cost?: number; supplier?: string; program?: string };

/** GET /api/monitoring -- everything the Monitoring tab shows: recent
 *  Purchase Requests (with their current workflow office and how long
 *  they've sat there), recent supplier proposals, the configured PR
 *  workflow, per-supplier / per-program consolidation totals (for
 *  deciding how to split POs -- one PO per supplier, foreign titles that
 *  need more than one supplier flagged by having no single supplier
 *  covering the full list), and per-campus budget vs. spent. */
export async function GET(req: Request) {
  try {
    const db = serviceClient();
    const email = userEmailFromRequest(req);
    const perms = await getUserPermissions(db, email);
    if (!perms.isAdmin && !perms.tabs["monitoring"]?.can_view) {
      return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
    }

    const [prRes, offersRes, stepsRes, budgetsRes, campusesRes] = await Promise.all([
      db.from("purchase_requests")
        .select("id, pr_no, submitted_by, office, purpose, items, total_amount, campus, campus_id, current_step_seq, step_entered_at, status, created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      db.from("supplier_offers").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("pr_workflow_steps").select("id, seq, office_name").order("seq"),
      db.from("campus_budgets").select("id, campus_id, period, amount, updated_at, updated_by"),
      db.from("campuses").select("id, name"),
    ]);
    if (prRes.error) throw prRes.error;
    if (offersRes.error) throw offersRes.error;
    if (stepsRes.error) throw stepsRes.error;
    if (budgetsRes.error) throw budgetsRes.error;
    if (campusesRes.error) throw campusesRes.error;

    const steps: WorkflowStep[] = stepsRes.data ?? [];
    const officeBySeq = new Map(steps.map((s) => [s.seq, s.office_name]));
    const campusNameById = new Map((campusesRes.data ?? []).map((c) => [c.id as number, c.name as string]));

    const prRows = prRes.data ?? [];
    const now = Date.now();
    const purchaseRequests: PurchaseRequestRow[] = prRows.map((r) => {
      const daysInStep = r.step_entered_at ? Math.floor((now - new Date(r.step_entered_at).getTime()) / 86400000) : null;
      return {
        id: r.id, pr_no: r.pr_no, submitted_by: r.submitted_by, office: r.office,
        purpose: r.purpose, campus: r.campus || "",
        item_count: Array.isArray(r.items) ? r.items.length : 0,
        total_amount: Number(r.total_amount ?? 0), created_at: r.created_at,
        current_step_seq: r.current_step_seq,
        current_office: r.current_step_seq != null ? officeBySeq.get(r.current_step_seq) ?? null : null,
        step_entered_at: r.step_entered_at,
        days_in_step: r.status === "completed" ? null : daysInStep,
        overdue: r.status !== "completed" && daysInStep != null && daysInStep > OVERDUE_DAYS,
        status: r.status,
      };
    });

    // Consolidation: aggregate every PR's line items by supplier and by
    // program, so one PO can be generated per supplier and foreign titles
    // that no single supplier covers stand out (their "programs"/"campuses"
    // spread will look scattered vs. a local publisher's tight cluster).
    const bySupplier = new Map<string, { item_count: number; total_amount: number; programs: Set<string>; campuses: Set<string> }>();
    const byProgram = new Map<string, { item_count: number; total_amount: number; campuses: Set<string> }>();
    for (const r of prRows) {
      const items = (Array.isArray(r.items) ? r.items : []) as ItemLine[];
      const campusLabel = r.campus || "Unspecified";
      for (const item of items) {
        const qty = Number(item.quantity ?? 0);
        const cost = Number(item.unit_cost ?? 0);
        const lineTotal = qty * cost;
        const supplierKey = (item.supplier || "").trim() || "Unspecified";
        const programKey = (item.program || "").trim() || "Unspecified";

        if (!bySupplier.has(supplierKey)) bySupplier.set(supplierKey, { item_count: 0, total_amount: 0, programs: new Set(), campuses: new Set() });
        const s = bySupplier.get(supplierKey)!;
        s.item_count += 1; s.total_amount += lineTotal; s.programs.add(programKey); s.campuses.add(campusLabel);

        if (!byProgram.has(programKey)) byProgram.set(programKey, { item_count: 0, total_amount: 0, campuses: new Set() });
        const p = byProgram.get(programKey)!;
        p.item_count += 1; p.total_amount += lineTotal; p.campuses.add(campusLabel);
      }
    }
    const supplierSummary: SupplierSummaryRow[] = Array.from(bySupplier.entries())
      .map(([supplier, v]) => ({ supplier, item_count: v.item_count, total_amount: v.total_amount, programs: Array.from(v.programs), campuses: Array.from(v.campuses) }))
      .sort((a, b) => b.total_amount - a.total_amount);
    const programSummary: ProgramSummaryRow[] = Array.from(byProgram.entries())
      .map(([program, v]) => ({ program, item_count: v.item_count, total_amount: v.total_amount, campuses: Array.from(v.campuses) }))
      .sort((a, b) => b.total_amount - a.total_amount);

    // Budget vs. spent per campus/period -- spent is always computed live
    // from purchase_requests, never stored, so it's never stale.
    const spentByCampusPeriod = new Map<string, number>();
    for (const r of prRows) {
      if (r.campus_id == null) continue;
      const period = String(new Date(r.created_at).getFullYear());
      const key = `${r.campus_id}:${period}`;
      spentByCampusPeriod.set(key, (spentByCampusPeriod.get(key) ?? 0) + Number(r.total_amount ?? 0));
    }
    const campusBudgets: CampusBudgetRow[] = (budgetsRes.data ?? []).map((b) => {
      const spent = spentByCampusPeriod.get(`${b.campus_id}:${b.period}`) ?? 0;
      const amount = Number(b.amount ?? 0);
      return {
        campus_id: b.campus_id, campus_name: campusNameById.get(b.campus_id) ?? `Campus #${b.campus_id}`,
        period: b.period, amount, spent, remaining: amount - spent, over: spent > amount,
      };
    }).sort((a, b) => a.campus_name.localeCompare(b.campus_name) || b.period.localeCompare(a.period));

    const offers = offersRes.data ?? [];
    const subjectIds = Array.from(new Set(offers.map((o) => o.subject_id).filter((id): id is number => id != null)));
    const labelMap = new Map<number, string>();
    const programBySubject = new Map<number, string>();
    if (subjectIds.length) {
      const { data: subs } = await db.from("subjects").select("id, course_code, course_title, program_id").in("id", subjectIds);
      const programIds = Array.from(new Set((subs ?? []).map((s) => s.program_id).filter((id): id is number => id != null)));
      const programNameById = new Map<number, string>();
      if (programIds.length) {
        const { data: progs } = await db.from("programs").select("id, name").in("id", programIds);
        for (const p of progs ?? []) programNameById.set(p.id, p.name);
      }
      for (const s of subs ?? []) {
        labelMap.set(s.id, [s.course_code, s.course_title].filter(Boolean).join(" — "));
        if (s.program_id != null) programBySubject.set(s.id, programNameById.get(s.program_id) ?? "");
      }
    }
    const proposals = offers.map((o) => ({
      ...o,
      subject_label: o.subject_id != null ? labelMap.get(o.subject_id) ?? "" : "",
      program: o.subject_id != null ? programBySubject.get(o.subject_id) ?? "" : "",
    }));

    return NextResponse.json({
      purchaseRequests, proposals, workflowSteps: steps,
      supplierSummary, programSummary, campusBudgets,
      campuses: campusesRes.data ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
