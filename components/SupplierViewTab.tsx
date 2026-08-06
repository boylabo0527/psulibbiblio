"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { isSpreadsheet, parseSheetRows } from "@/lib/parse-client";
import type { SupplierNeedRow } from "@/app/api/supplier/needs/route";
import type { SupplierOfferRow } from "@/app/api/supplier/offers/route";

const UPLOAD_ALIASES: Record<string, string[]> = {
  course_code: ["code", "course code", "course_code"],
  title: ["offer title", "title"],
  author: ["offer author", "author"],
  format: ["offer format", "format"],
  price: ["price", "price (₱)", "price (php)"],
  notes: ["notes"],
};

function normHeader(s: string) {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mapUploadRow(row: Record<string, string>): { course_code: string; title: string; author: string; format: string; price: string; notes: string } {
  const normed = new Map(Object.keys(row).map((k) => [normHeader(k), k]));
  const get = (canonical: string) => {
    for (const alt of UPLOAD_ALIASES[canonical]) {
      const actual = normed.get(alt);
      if (actual) return row[actual] ?? "";
    }
    return "";
  };
  return {
    course_code: get("course_code"), title: get("title"), author: get("author"),
    format: get("format"), price: get("price"), notes: get("notes"),
  };
}

const STATUS_LABEL: Record<string, string> = { pending: "Pending", accepted: "Accepted", declined: "Declined" };
const STATUS_COLOR: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  accepted: "bg-green-100 text-green-700",
  declined: "bg-red-100 text-red-700",
};

export default function SupplierViewTab() {
  const [rows, setRows] = useState<SupplierNeedRow[]>([]);
  const [offers, setOffers] = useState<SupplierOfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [offerFor, setOfferFor] = useState<SupplierNeedRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; problems: { line: number; course_code: string; reason: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [programFilter, setProgramFilter] = useState("");
  const [sortBy, setSortBy] = useState<"gap_desc" | "gap_asc" | "program_asc">("gap_desc");

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiFetch("/api/supplier/needs").then((r) => r.json()),
      apiFetch("/api/supplier/offers").then((r) => r.json()),
    ])
      .then(([needsJ, offersJ]) => {
        if (needsJ.error) throw new Error(needsJ.error);
        if (offersJ.error) throw new Error(offersJ.error);
        setRows(needsJ.rows ?? []);
        setOffers(offersJ.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const programOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.program).filter(Boolean))).sort(), [rows]);
  const displayedRows = useMemo(() => {
    const filtered = programFilter ? rows.filter((r) => r.program === programFilter) : rows;
    const sorted = [...filtered];
    if (sortBy === "gap_desc") sorted.sort((a, b) => b.gap - a.gap);
    else if (sortBy === "gap_asc") sorted.sort((a, b) => a.gap - b.gap);
    else if (sortBy === "program_asc") sorted.sort((a, b) => a.program.localeCompare(b.program) || b.gap - a.gap);
    return sorted;
  }, [rows, programFilter, sortBy]);

  // Needed titles by campus -- a subject whose program is offered at more
  // than one campus counts toward each of them (the title is genuinely
  // needed at every campus that runs that program), not split fractionally.
  // Rows with no campus mapping configured yet fall into "Unspecified"
  // rather than disappearing from the summary.
  const campusSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const campuses = r.campuses.length > 0 ? r.campuses : ["Unspecified"];
      for (const c of campuses) counts.set(c, (counts.get(c) ?? 0) + r.gap);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const maxCampusGap = campusSummary.length > 0 ? campusSummary[0][1] : 0;

  // The export doubles as the bulk-upload template: a supplier downloads
  // this, fills in Offer Title/Author/Format/Price/Notes on whichever rows
  // they can supply -- adding extra rows with the same Code to offer more
  // than one title for a single need -- and uploads it back below.
  function exportCsv() {
    const headers = ["Program", "Code", "Subject", "Have (Printed)", "Have (Digital)", "Titles Needed", "Printed Needed", "Offer Title", "Offer Author", "Offer Format", "Price", "Notes"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const cells = [r.program, r.course_code, r.course_title, r.current_printed, r.current_digital, r.gap, r.needs_printed ? "Yes" : "No", "", "", "", "", ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "titles_we_need.csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function uploadOffersFile(file: File) {
    setUploading(true);
    setErr(null);
    setUploadResult(null);
    try {
      if (!isSpreadsheet(file)) throw new Error("Please upload the .csv or .xlsx file (the same one you downloaded).");
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(mapUploadRow).filter((r) => r.course_code.trim() && r.title.trim());
      if (!mapped.length) {
        throw new Error("No rows with both a Code and an Offer Title were found. Fill those in on the downloaded template first.");
      }
      const res = await apiFetch("/api/supplier/offers/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: mapped }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setUploadResult({ inserted: j.inserted ?? 0, problems: j.problems ?? [] });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      {campusSummary.length > 0 && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Needs by Campus</h2>
          <p className="text-xs text-slate-500 mb-3">
            How many more titles are needed at each campus -- a program offered at more than one campus counts
            toward each of them.
          </p>
          <div className="space-y-2">
            {campusSummary.map(([campus, count]) => (
              <div key={campus} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-40 shrink-0 truncate" title={campus}>{campus}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="h-3 rounded-full bg-psu transition-all" style={{ width: `${maxCampusGap > 0 ? (count / maxCampusGap) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-slate-600 w-10 text-right tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Titles We Need</h2>
          <div className="flex gap-2 shrink-0">
            <button className="btn-outline text-xs whitespace-nowrap" disabled={!rows.length} onClick={exportCsv}>
              Download CSV
            </button>
            <button
              className="btn-outline text-xs whitespace-nowrap"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload offers file"}
            </button>
            <input
              ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOffersFile(f); }}
            />
          </div>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Subjects currently short of the required number of recent titles. Numbers show what&apos;s already in our
          collection (printed / digital) and how many more titles are still needed overall. Click &quot;Offer&quot;
          to propose a title against a specific need, or offer many at once: download the CSV, fill in Offer
          Title/Author/Format/Price/Notes on whichever rows you can supply (add extra rows with the same Code to
          offer more than one title for a need), then upload it back with &quot;Upload offers file&quot;.
        </p>

        {uploadResult && (
          <div className="mb-3 bg-slate-50 border border-slate-200 rounded p-2.5 text-xs">
            <p className={uploadResult.inserted ? "text-green-700" : "text-slate-600"}>
              {uploadResult.inserted
                ? `${uploadResult.inserted} title offer${uploadResult.inserted === 1 ? "" : "s"} submitted from your file.`
                : "No offers were submitted from that file."}
            </p>
            {uploadResult.problems.length > 0 && (
              <div className="text-amber-700 mt-1">
                <p>{uploadResult.problems.length} row{uploadResult.problems.length === 1 ? "" : "s"} skipped:</p>
                <ul className="list-disc ml-4 mt-1">
                  {uploadResult.problems.map((p, i) => (
                    <li key={i}>Row {p.line} (code &quot;{p.course_code}&quot;): {p.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && rows.length === 0 && <p className="text-slate-500 text-sm">No open needs right now.</p>}

        {!loading && rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Program:
                <select className="input text-xs py-1" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
                  <option value="">All programs</option>
                  {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500 flex items-center gap-1.5">
                Sort by:
                <select className="input text-xs py-1" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="gap_desc">Most needed first</option>
                  <option value="gap_asc">Least needed first</option>
                  <option value="program_asc">Program A-Z</option>
                </select>
              </label>
            </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 text-left">
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Campus</th>
                  <th className="py-1 pr-2 w-24">Code</th>
                  <th className="py-1 pr-2">Subject</th>
                  <th className="py-1 px-2 text-right">Have (Printed)</th>
                  <th className="py-1 px-2 text-right">Have (Digital)</th>
                  <th className="py-1 px-2 text-right">Titles Needed</th>
                  <th className="py-1 px-2"></th>
                  <th className="py-1 px-2">Faculty Suggested</th>
                  <th className="py-1 pl-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.campuses.length > 0 ? r.campuses.join(", ") : "—"}</td>
                    <td className="py-1.5 pr-2 text-slate-500">{r.course_code}</td>
                    <td className="py-1.5 pr-2">{r.course_title}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_printed}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.current_digital}</td>
                    <td className="py-1.5 px-2 text-right font-semibold tabular-nums text-red-600">+{r.gap}</td>
                    <td className="py-1.5 px-2">
                      {r.needs_printed && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="A recent printed copy is specifically required, not just any format">
                          Printed needed
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-slate-600 max-w-[220px]">
                      {r.recommended_titles.length > 0 && (
                        <span title={r.recommended_titles.map(t =>
                          `${t.title}${t.author ? ` — ${t.author}` : ""}${t.year ? ` (${t.year})` : ""}`
                          + `${t.publisher ? `\nPublisher: ${t.publisher}` : ""}${t.isbn ? `\nISBN: ${t.isbn}` : ""}`
                          + `${t.format_preference ? `\nFormat: ${t.format_preference}` : ""}${t.price_estimate != null ? `\nEst. price: ₱${t.price_estimate.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : ""}`
                          + `${t.notes ? `\nNotes: ${t.notes}` : ""}`,
                        ).join("\n\n")}>
                          {r.recommended_titles.slice(0, 2).map(t => t.title).join("; ")}
                          {r.recommended_titles.length > 2 ? ` +${r.recommended_titles.length - 2} more` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-psu text-[11px] underline" onClick={() => setOfferFor(r)}>
                        {r.gap > 1 ? `Offer titles` : "Offer"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {offerFor && (
        <OfferForm need={offerFor} onClose={() => setOfferFor(null)} onSubmitted={() => { setOfferFor(null); load(); }} />
      )}

      <div className="card">
        <h2 className="text-psu font-semibold mb-1">Your Submitted Offers</h2>
        {!loading && offers.length === 0 && <p className="text-slate-500 text-sm">No offers submitted yet.</p>}
        {!loading && offers.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-left">
                <th className="py-1 pr-2">Subject</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 px-2">Format</th>
                <th className="py-1 px-2">Faculty request</th>
                <th className="py-1 px-2 text-right">Price</th>
                <th className="py-1 pl-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-500">
                    {o.subject_label || "—"}
                    {o.batch_size && o.batch_size > 1 && (
                      <span className="ml-1 inline-block rounded px-1 py-0.5 text-[9px] font-medium bg-slate-100 text-slate-500" title="Submitted together with other titles for this subject">
                        1 of {o.batch_size}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">{o.title}</td>
                  <td className="py-1.5 px-2 text-slate-500">{o.format || "—"}</td>
                  <td className="py-1.5 px-2 text-slate-500">
                    {o.recommendation_id != null ? (
                      <span
                        className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " + (o.match_type === "alternative" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}
                        title={o.recommendation_title ? `Faculty requested: ${o.recommendation_title}` : undefined}
                      >
                        {o.match_type === "alternative" ? "Alternative" : "Exact title"}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{o.price != null ? o.price.toLocaleString() : "—"}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <span className={"inline-block rounded px-1.5 py-0.5 text-[10px] font-medium " + STATUS_COLOR[o.status]}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type OfferRowInput = {
  title: string; author: string; format: string; price: string; notes: string;
  recommendation_id: number | null; match_type: "exact" | "alternative" | null;
};

function emptyOfferRow(): OfferRowInput {
  return { title: "", author: "", format: "", price: "", notes: "", recommendation_id: null, match_type: null };
}

function OfferForm({
  need, onClose, onSubmitted,
}: {
  need: SupplierNeedRow;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  // Seeded with one row per faculty-recommended title (pre-tied to that
  // recommendation, defaulted to "exact title") plus blank rows to round
  // out the remaining gap -- capped so a huge gap doesn't dump 50 blank
  // rows on the supplier. They can add/remove rows and retarget/retype
  // freely from there.
  const [items, setItems] = useState<OfferRowInput[]>(() => {
    const seeded: OfferRowInput[] = need.recommended_titles.map((rt) => ({
      title: rt.title, author: rt.author, format: rt.format_preference || "", price: "", notes: "",
      recommendation_id: rt.id, match_type: "exact",
    }));
    const target = Math.max(seeded.length || 1, Math.min(need.gap || 1, 10));
    const blanks = Array.from({ length: Math.max(0, target - seeded.length) }, emptyOfferRow);
    return [...seeded, ...blanks];
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function updateItem(i: number, patch: Partial<OfferRowInput>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => [...prev, emptyOfferRow()]);
  }
  function removeRow(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    const filled = items.filter((it) => it.title.trim());
    if (!filled.length) { setErr("At least one title is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/supplier/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: need.subject_id,
          offers: filled.map((it) => ({
            title: it.title, author: it.author, format: it.format,
            price: it.price.trim() === "" ? null : Number(it.price), notes: it.notes,
            recommendation_id: it.recommendation_id, match_type: it.recommendation_id != null ? it.match_type : null,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-2 border-psu-light">
      <h3 className="text-psu font-semibold mb-1">Offer titles for &quot;{need.course_title}&quot;</h3>
      <p className="text-xs text-slate-500 mb-3">
        {need.program} · {need.course_code} · needs {need.gap} more title{need.gap === 1 ? "" : "s"}
      </p>

      {need.recommended_titles.length > 0 && (
        <div className="border border-slate-200 rounded p-2.5 mb-3 bg-slate-50/60">
          <p className="text-xs font-semibold text-slate-700 mb-1.5">Faculty-requested titles for this course</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Publisher</th>
                  <th className="py-1 pr-2">Year</th>
                  <th className="py-1 pr-2">ISBN</th>
                  <th className="py-1 pr-2">Format</th>
                  <th className="py-1 pr-2 text-right">Est. price</th>
                </tr>
              </thead>
              <tbody>
                {need.recommended_titles.map((rt) => (
                  <tr key={rt.id} className="border-t border-slate-200">
                    <td className="py-1 pr-2 font-medium">{rt.title}</td>
                    <td className="py-1 pr-2">{rt.author || "—"}</td>
                    <td className="py-1 pr-2">{rt.publisher || "—"}</td>
                    <td className="py-1 pr-2">{rt.year || "—"}</td>
                    <td className="py-1 pr-2">{rt.isbn || "—"}</td>
                    <td className="py-1 pr-2">{rt.format_preference || "either"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{rt.price_estimate != null ? `₱${rt.price_estimate.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            If you can supply one of these exactly, tie your offer to it below and mark it &quot;Exact title requested.&quot;
            If you can only offer something different (another edition, a substitute text, etc.), tie it to the request
            anyway but mark it &quot;Alternative&quot; so staff know it&apos;s not the exact title asked for.
          </p>
        </div>
      )}

      <div className="space-y-3 mb-3">
        {items.map((it, i) => (
          <div key={i} className="border border-slate-200 rounded p-2.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500">Title {i + 1}</span>
              {items.length > 1 && (
                <button className="text-red-600 text-[11px] underline" onClick={() => removeRow(i)}>Remove</button>
              )}
            </div>
            {need.recommended_titles.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-2 bg-slate-50 rounded p-2">
                <label className="label flex-col items-start">
                  Faculty request
                  <select
                    className="input"
                    value={it.recommendation_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      updateItem(i, { recommendation_id: v, match_type: v != null ? (it.match_type ?? "exact") : null });
                    }}
                  >
                    <option value="">— Not tied to a specific request —</option>
                    {need.recommended_titles.map((rt) => (
                      <option key={rt.id} value={rt.id}>{rt.title}{rt.author ? ` — ${rt.author}` : ""}</option>
                    ))}
                  </select>
                </label>
                {it.recommendation_id != null && (
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="radio" name={`match-${i}`} checked={it.match_type === "exact"} onChange={() => updateItem(i, { match_type: "exact" })} />
                      Exact title requested
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name={`match-${i}`} checked={it.match_type === "alternative"} onChange={() => updateItem(i, { match_type: "alternative" })} />
                      Alternative
                    </label>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="label flex-col items-start">
                Title
                <input className="input w-full" value={it.title} onChange={(e) => updateItem(i, { title: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Author
                <input className="input w-full" value={it.author} onChange={(e) => updateItem(i, { author: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Format (e.g. printed book, ebook)
                <input className="input w-full" value={it.format} onChange={(e) => updateItem(i, { format: e.target.value })} />
              </label>
              <label className="label flex-col items-start">
                Price (₱)
                <input type="number" min={0} step="0.01" className="input w-full" value={it.price} onChange={(e) => updateItem(i, { price: e.target.value })} />
              </label>
              <label className="label flex-col items-start col-span-2">
                Notes (availability, edition, etc.)
                <textarea className="input w-full" rows={2} value={it.notes} onChange={(e) => updateItem(i, { notes: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-outline text-xs mb-3" onClick={addRow}>+ Add another title</button>

      {err && <p className="text-red-700 text-xs mb-2">{err}</p>}
      <div className="flex gap-2">
        <button className="btn text-xs" disabled={busy} onClick={submit}>
          {busy ? "Submitting…" : items.filter((it) => it.title.trim()).length > 1 ? "Submit all titles" : "Submit offer"}
        </button>
        <button className="btn-outline text-xs" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
