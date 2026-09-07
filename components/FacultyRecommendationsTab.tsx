"use client";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { usePermissions } from "@/lib/use-permissions";
import { useAuth } from "@/components/AuthProvider";
import SearchableSelect from "@/components/SearchableSelect";
import type { TitleRecommendationRow } from "@/app/api/title-recommendations/route";
import type { ProcurementRow } from "@/app/api/procurement/route";
import type { CanvassingRow } from "@/app/api/canvassing/route";
import { isPriceStale, daysSincePriced } from "@/lib/pricing";
import { groupRows } from "@/lib/group-rows";
import { isSpreadsheet, parseSheetRows } from "@/lib/parse-client";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  sourced: "bg-emerald-100 text-emerald-700",
  declined: "bg-slate-200 text-slate-600",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

type DraftTitle = {
  title: string; author: string; publisher: string; year: string; isbn: string;
  format_preference: string; notes: string; price_estimate: string;
  /** Set when this row was added from the "browse what's already been
   *  canvassed" cart below instead of typed in -- it already has a real
   *  supplier and price, so it's a much faster path to an actual purchase
   *  than a from-scratch suggestion. */
  canvassing_id: number | null;
  supplier?: string; unit_cost?: number; canvass_date?: string;
};
function emptyDraftTitle(): DraftTitle {
  return { title: "", author: "", publisher: "", year: "", isbn: "", format_preference: "", notes: "", price_estimate: "", canvassing_id: null };
}
function isEmptyDraft(t: DraftTitle): boolean {
  return !t.title && !t.author && !t.publisher && !t.year && !t.isbn && !t.notes && t.canvassing_id == null;
}

type BulkRow = {
  program: string; course_code: string; title: string; author: string; publisher: string;
  year: string; isbn: string; format_preference: string; price_estimate: string; notes: string;
};
function mapBulkRow(raw: Record<string, string>): BulkRow {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.entries(raw).find(([rk]) => rk.toLowerCase() === k.toLowerCase());
      if (found && found[1] !== "") return found[1];
    }
    return "";
  };
  return {
    program: get("program"),
    course_code: get("course code", "course_code", "code"),
    title: get("title", "book title"),
    author: get("author", "authors"),
    publisher: get("publisher"),
    year: get("year"),
    isbn: get("isbn"),
    format_preference: get("format preference", "format_preference", "format"),
    price_estimate: get("price estimate", "price_estimate", "price", "estimated cost"),
    notes: get("notes", "remarks"),
  };
}
async function downloadBulkTemplate(fmt: "xlsx" | "csv") {
  const XLSX = await import("xlsx");
  const headers = ["Program", "Course Code", "Title", "Author", "Publisher", "Year", "ISBN", "Format Preference", "Price Estimate", "Notes"];
  const example = ["BA Political Science", "PSM 1", "Introduction to Philosophy", "Popkin, Richard", "Cengage", "2020", "978-0-123456-78-9", "printed", "850", ""];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recommendations");
  const buf = XLSX.write(wb, { type: "buffer", bookType: fmt });
  const blob = new Blob([buf], { type: fmt === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `recommendations_template.${fmt}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

/** Lets a faculty member recommend one or more specific titles for a
 *  course they teach in a single submission -- a concrete starting point
 *  for Market Canvassing and for suppliers browsing needs (see
 *  /api/supplier/needs), rather than staff and suppliers only ever
 *  seeing a generic "needs N more titles" gap. Faculty submit and see
 *  everything (so they don't duplicate a suggestion someone else already
 *  made); reviewing/marking status is restricted to whoever can edit
 *  Market Canvassing (or admin). */
export default function FacultyRecommendationsTab() {
  const { perms } = usePermissions();
  const { user } = useAuth();
  const canReview = perms.isAdmin || !!perms.tabs["canvassing"]?.can_edit;

  const [subjects, setSubjects] = useState<ProcurementRow[]>([]);
  const [rows, setRows] = useState<TitleRecommendationRow[]>([]);
  const [catalog, setCatalog] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "sourced" | "declined">("all");
  const [programFilter, setProgramFilter] = useState("");

  const [subjectId, setSubjectId] = useState("");
  const [titles, setTitles] = useState<DraftTitle[]>([emptyDraftTitle()]);
  const [submitting, setSubmitting] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSort, setCatalogSort] = useState<"title_asc" | "price_asc" | "price_desc" | "newest">("title_asc");
  const [catalogCollege, setCatalogCollege] = useState("");

  const [parsed, setParsed] = useState<BulkRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: { row: number; reason: string }[] } | null>(null);

  const [reassigning, setReassigning] = useState<number | null>(null);
  const [reassignTarget, setReassignTarget] = useState<Record<number, string>>({});

  function load() {
    setLoading(true);
    setErr(null);
    Promise.all([
      apiFetch("/api/procurement").then((r) => r.json()),
      apiFetch("/api/title-recommendations").then((r) => r.json()),
      apiFetch("/api/canvassing").then((r) => r.json()).catch(() => ({ rows: [] })),
    ])
      .then(([subRes, recRes, canvRes]) => {
        if (subRes.error) throw new Error(subRes.error);
        if (recRes.error) throw new Error(recRes.error);
        setSubjects(subRes.rows ?? []);
        setRows(recRes.rows ?? []);
        setCatalog(canvRes.rows ?? []);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const courseGroups = useMemo(() => {
    const map = new Map<string, ProcurementRow[]>();
    for (const s of subjects) {
      if (!map.has(s.program)) map.set(s.program, []);
      map.get(s.program)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, subs]) => ({
        label,
        options: subs.map((s) => ({ value: String(s.subject_id), label: `${s.course_code} — ${s.course_title}` })),
      }));
  }, [subjects]);

  const programOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.program).filter(Boolean))).sort(), [rows]);

  const cartIds = useMemo(() => new Set(titles.map((t) => t.canvassing_id).filter((id): id is number => id != null)), [titles]);

  const collegeOptions = useMemo(() => Array.from(new Set(catalog.map((c) => c.college).filter(Boolean))).sort(), [catalog]);

  const catalogGroups = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    let list = catalog;
    if (q) list = list.filter((c) =>
      c.title.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.supplier.toLowerCase().includes(q));
    if (catalogCollege) list = list.filter((c) => c.college === catalogCollege);
    const sorted = [...list];
    if (catalogSort === "title_asc") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (catalogSort === "price_asc") sorted.sort((a, b) => a.unit_cost - b.unit_cost);
    else if (catalogSort === "price_desc") sorted.sort((a, b) => b.unit_cost - a.unit_cost);
    else if (catalogSort === "newest") sorted.sort((a, b) => (b.canvass_date || b.created_at).localeCompare(a.canvass_date || a.created_at));
    // Grouped by college so a professor can jump straight to their own
    // college's titles instead of scanning every program's -- staff/admin
    // set each program's college in Campus Validation. Titles whose
    // program has none set fall into "Unspecified" (groupRows' default).
    return groupRows(sorted, "college", (c) => c.college);
  }, [catalog, catalogSearch, catalogSort, catalogCollege]);

  function setTitleField(i: number, field: keyof DraftTitle, value: string) {
    setTitles((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }
  function addTitleRow() {
    setTitles((prev) => [...prev, emptyDraftTitle()]);
  }
  function removeTitleRow(i: number) {
    setTitles((prev) => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));
  }

  /** "Add to cart" from the browse list -- prefills a row instead of
   *  requiring faculty to retype a title that's already been priced with a
   *  supplier. Fields stay editable afterward like any other row. */
  function addFromCatalog(c: CanvassingRow) {
    if (cartIds.has(c.id)) return;
    const drafted: DraftTitle = {
      title: c.title, author: c.author, publisher: c.publisher, year: c.year, isbn: c.isbn,
      format_preference: "", notes: "", price_estimate: c.unit_cost ? String(c.unit_cost) : "",
      canvassing_id: c.id, supplier: c.supplier, unit_cost: c.unit_cost, canvass_date: c.canvass_date || c.created_at,
    };
    setTitles((prev) => {
      if (prev.length === 1 && isEmptyDraft(prev[0])) return [drafted];
      return [...prev, drafted];
    });
  }

  const validTitles = titles.filter((t) => t.title.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectId || validTitles.length === 0) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/title-recommendations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: Number(subjectId),
          titles: validTitles.map((t) => ({
            title: t.title, author: t.author, publisher: t.publisher, year: t.year, isbn: t.isbn,
            format_preference: t.format_preference, notes: t.notes, canvassing_id: t.canvassing_id,
            price_estimate: t.price_estimate.trim() ? Number(t.price_estimate) : null,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setTitles([emptyDraftTitle()]);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(id: number, status: string) {
    setBusyId(id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/title-recommendations/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r: TitleRecommendationRow) {
    if (!confirm(`Remove recommendation "${r.title}"?`)) return;
    setBusyId(r.id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/title-recommendations/${r.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleFile(file: File) {
    if (!isSpreadsheet(file)) { setUploadErr("Please upload an Excel (.xlsx/.xls) or CSV file."); return; }
    setParsing(true); setUploadErr(null); setUploadResult(null); setParsed([]);
    try {
      const rawRows = await parseSheetRows(file);
      const mapped = rawRows.map(mapBulkRow).filter((r) => r.title.trim() !== "");
      if (mapped.length === 0) { setUploadErr("No valid rows found. Ensure the file has Program, Course Code, and Title columns."); return; }
      setParsed(mapped);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setParsing(false); }
  }

  async function importParsed() {
    if (parsed.length === 0) return;
    setUploading(true); setUploadErr(null); setUploadResult(null);
    try {
      const res = await apiFetch("/api/title-recommendations/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsed }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) { setUploadErr(j.error || `HTTP ${res.status}`); return; }
      setUploadResult({ inserted: j.inserted ?? 0, errors: j.errors ?? [] });
      setParsed([]);
      load();
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally { setUploading(false); }
  }

  async function reassign(id: number) {
    const subjectId = reassignTarget[id];
    if (!subjectId) return;
    setReassigning(id);
    setErr(null);
    try {
      const res = await apiFetch(`/api/title-recommendations/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject_id: Number(subjectId) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
      setReassignTarget((prev) => { const next = { ...prev }; delete next[id]; return next; });
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReassigning(null);
    }
  }

  const displayed = rows
    .filter((r) => statusFilter === "all" || r.status === statusFilter)
    .filter((r) => !programFilter || r.program === programFilter);

  return (
    <div className="space-y-4">
      {perms.tabs["faculty-recommendations"]?.can_edit && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Recommend Titles</h2>
          <p className="text-xs text-slate-500 mb-3">
            Suggest one or more specific books for a course you teach -- these become a starting point for
            Market Canvassing and are shown to suppliers browsing what's needed, instead of just a generic gap count.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <label className="label flex-col items-start gap-1">
              <span className="text-xs">Course</span>
              <SearchableSelect
                value={subjectId}
                onChange={setSubjectId}
                groups={courseGroups}
                placeholder="Type to search a course…"
                className="input w-full max-w-md"
              />
            </label>

            <div className="border border-slate-200 rounded p-3 bg-slate-50/60">
              <div className="mb-2">
                <span className="text-xs font-semibold text-slate-700">Browse titles already priced with a supplier</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  These have already been market-canvassed, so they already have a real supplier and price -- picking one here
                  is faster than typing a title from scratch and gets a click closer to an actual purchase. Search or sort to
                  find something for your course, then click <span className="font-medium">Add</span>. You can still remove or
                  edit it below before submitting, or add your own titles the old way if what you want isn't listed yet.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <input
                  className="input text-xs py-1 flex-1 min-w-[180px]"
                  placeholder="Search title, author, or supplier…"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  College:
                  <select className="input text-xs py-1" value={catalogCollege} onChange={(e) => setCatalogCollege(e.target.value)}>
                    <option value="">All colleges</option>
                    {collegeOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500 flex items-center gap-1.5">
                  Sort:
                  <select className="input text-xs py-1" value={catalogSort} onChange={(e) => setCatalogSort(e.target.value as typeof catalogSort)}>
                    <option value="title_asc">Title A-Z</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="newest">Newest canvassed</option>
                  </select>
                </label>
              </div>
              <div className="max-h-72 overflow-y-auto border border-slate-200 rounded bg-white">
                <table className="w-full text-xs">
                  <tbody>
                    {catalogGroups.flatMap(([label, items]) => [
                      <tr key={`g-${label}`} className="bg-slate-50 sticky top-0">
                        <td colSpan={3} className="py-1 px-2 font-semibold text-slate-600">{label || "Unspecified college"} · {items.length}</td>
                      </tr>,
                      ...items.map((c) => {
                        const inCart = cartIds.has(c.id);
                        const stale = isPriceStale(c.canvass_date || c.created_at);
                        return (
                          <tr key={c.id} className="border-b border-slate-100 last:border-0">
                            <td className="py-1.5 pl-2 pr-2">
                              <div className="font-medium">{c.title}{c.year ? ` (${c.year})` : ""}</div>
                              <div className="text-slate-500">
                                {c.author && <>{c.author} · </>}{c.supplier || "Supplier not noted"}
                                {c.subject_label && <> · already linked to {c.subject_label}</>}
                              </div>
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                              ₱{c.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                              {stale && <span className="ml-1 text-amber-600" title={`Quoted ${daysSincePriced(c.canvass_date || c.created_at)} days ago -- may need re-verifying before purchase`}>⚠</span>}
                            </td>
                            <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                className={inCart ? "text-slate-400 text-[11px]" : "text-psu text-[11px] underline"}
                                disabled={inCart}
                                onClick={() => addFromCatalog(c)}
                              >
                                {inCart ? "Added ✓" : "+ Add"}
                              </button>
                            </td>
                          </tr>
                        );
                      }),
                    ])}
                    {catalog.length === 0 && (
                      <tr><td colSpan={3} className="py-3 text-center text-slate-400">Nothing canvassed yet.</td></tr>
                    )}
                    {catalog.length > 0 && catalogGroups.every(([, items]) => items.length === 0) && (
                      <tr><td colSpan={3} className="py-3 text-center text-slate-400">No matches.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              {titles.map((t, i) => (
                <div key={i} className="border border-slate-200 rounded p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-500">
                      Title {i + 1}
                      {t.canvassing_id != null && (
                        <span className="ml-2 inline-block bg-psu-light text-psu rounded px-1.5 py-0.5 text-[10px] font-normal">
                          From canvassing · {t.supplier || "supplier"} · ₱{(t.unit_cost ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </span>
                    {titles.length > 1 && (
                      <button type="button" className="text-red-500 text-[11px] underline" onClick={() => removeTitleRow(i)}>Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Title *</span>
                      <input className="input w-full" value={t.title} onChange={(e) => setTitleField(i, "title", e.target.value)} />
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Author</span>
                      <input className="input w-full" value={t.author} onChange={(e) => setTitleField(i, "author", e.target.value)} />
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Publisher</span>
                      <input className="input w-full" value={t.publisher} onChange={(e) => setTitleField(i, "publisher", e.target.value)} />
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Year</span>
                      <input className="input w-full" value={t.year} onChange={(e) => setTitleField(i, "year", e.target.value)} />
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">ISBN</span>
                      <input className="input w-full" value={t.isbn} onChange={(e) => setTitleField(i, "isbn", e.target.value)} />
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Format preference</span>
                      <select className="input w-full" value={t.format_preference} onChange={(e) => setTitleField(i, "format_preference", e.target.value)}>
                        <option value="">Either is fine</option>
                        <option value="printed">Printed preferred</option>
                        <option value="ebook">eBook preferred</option>
                      </select>
                    </label>
                    <label className="label flex-col items-start gap-1">
                      <span className="text-xs">Price estimate (₱)</span>
                      <input type="number" min="0" step="0.01" className="input w-full" value={t.price_estimate} onChange={(e) => setTitleField(i, "price_estimate", e.target.value)} placeholder="Optional ballpark cost" />
                    </label>
                  </div>
                  <label className="label flex-col items-start gap-1 mt-3">
                    <span className="text-xs">Notes</span>
                    <textarea className="input w-full h-14 resize-none" value={t.notes} onChange={(e) => setTitleField(i, "notes", e.target.value)} placeholder="Why this title, edition notes, etc." />
                  </label>
                </div>
              ))}
            </div>
            <button type="button" className="btn-outline text-xs" onClick={addTitleRow}>+ Add another title</button>

            {err && <p className="text-red-700 text-sm">{err}</p>}
            <div>
              <button type="submit" className="btn text-sm" disabled={submitting || !subjectId || validTitles.length === 0}>
                {submitting ? "Submitting…" : validTitles.length > 1 ? `Submit ${validTitles.length} Recommendations` : "Submit Recommendation"}
              </button>
            </div>
          </form>
        </div>
      )}

      {perms.tabs["faculty-recommendations"]?.can_edit && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-1">Bulk Upload by File</h2>
          <p className="text-xs text-slate-500 mb-1">
            Recommend titles for several courses at once -- each row names its own Program and Course Code, so a
            single file can cover your whole load instead of one course at a time. Program and Course Code must
            exactly match an existing program/course; a row that doesn't match is reported back instead of guessed at.
          </p>
          <div className="flex gap-2 mb-4 text-xs">
            <span className="text-slate-400">Download template:</span>
            <button className="text-psu underline" onClick={() => downloadBulkTemplate("xlsx")}>XLSX</button>
            <button className="text-psu underline" onClick={() => downloadBulkTemplate("csv")}>CSV</button>
          </div>
          <label className="label flex-col items-start gap-1 mb-3">
            <span>Recommendations file</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="text-xs"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          </label>
          {parsing && <p className="text-slate-500 text-sm">Parsing file…</p>}
          {uploadErr && <p className="text-red-700 text-sm mb-2">{uploadErr}</p>}
          {uploadResult && (
            <div className="text-sm mb-2">
              <p className="text-emerald-700">{uploadResult.inserted} recommendation(s) added.</p>
              {uploadResult.errors.length > 0 && (
                <div className="text-amber-700 text-xs mt-1">
                  {uploadResult.errors.length} row(s) skipped:
                  <ul className="list-disc list-inside">
                    {uploadResult.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
                    {uploadResult.errors.length > 10 && <li>…and {uploadResult.errors.length - 10} more.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
          {parsed.length > 0 && (
            <>
              <div className="overflow-x-auto mb-3 max-h-64 overflow-y-auto border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 px-2">Program</th>
                      <th className="py-1 px-2">Course</th>
                      <th className="py-1 px-2">Title</th>
                      <th className="py-1 px-2">Author</th>
                      <th className="py-1 px-2">Price est.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        <td className="py-1 px-2">{r.program}</td>
                        <td className="py-1 px-2">{r.course_code}</td>
                        <td className="py-1 px-2">{r.title}</td>
                        <td className="py-1 px-2">{r.author}</td>
                        <td className="py-1 px-2">{r.price_estimate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button className="btn text-sm" disabled={uploading} onClick={importParsed}>
                {uploading ? "Uploading…" : `Upload ${parsed.length} row(s)`}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="text-psu font-semibold">Recommendations</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-500 flex items-center gap-1.5">
              Program:
              <select className="input text-xs py-1" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
                <option value="">All programs</option>
                {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 flex items-center gap-1.5">
              Status:
              <select className="input text-xs py-1" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="sourced">Sourced</option>
                <option value="declined">Declined</option>
              </select>
            </label>
          </div>
        </div>
        {err && !perms.tabs["faculty-recommendations"]?.can_edit && <p className="text-red-700 text-sm mb-2">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}
        {!loading && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Program</th>
                  <th className="py-1 pr-2">Course</th>
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Format</th>
                  <th className="py-1 pr-2">Price est.</th>
                  <th className="py-1 pr-2">Recommended by</th>
                  <th className="py-1 pr-2">Status</th>
                  <th className="py-1 pl-2">When</th>
                  <th className="py-1 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((r) => {
                  const isOwnerPending = r.recommended_by === user?.email && r.status === "pending";
                  return (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-500">{r.program}</td>
                      <td className="py-1.5 pr-2">{r.subject_label}</td>
                      <td className="py-1.5 pr-2 font-medium">
                        {r.title}
                        {r.canvassing_id != null && (
                          <span className="ml-1.5 inline-block bg-psu-light text-psu rounded px-1.5 py-0.5 text-[10px] font-normal" title={`Already priced -- ${r.supplier || "supplier"}, ₱${(r.unit_cost ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}>
                            priced ✓
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.format_preference || "—"}</td>
                      <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">
                        {r.price_estimate != null ? `₱${r.price_estimate.toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-500">
                        {r.recommended_by}
                        {r.submitted_publicly && (
                          <span className="ml-1.5 inline-block bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 text-[10px] font-normal" title="Submitted through the public form, no sign-in -- not a verified PSU account">
                            Public{r.submitter_role ? ` · ${r.submitter_role}` : ""}
                          </span>
                        )}
                        {r.campus && (
                          <span className="ml-1.5 inline-block bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 text-[10px] font-normal" title="Campus the submitter suggested this for">
                            {r.campus}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {canReview ? (
                          <select
                            className="input text-[11px] py-0.5"
                            value={r.status} disabled={busyId === r.id}
                            onChange={(e) => setStatus(r.id, e.target.value)}
                          >
                            <option value="pending">Pending</option>
                            <option value="sourced">Sourced</option>
                            <option value="declined">Declined</option>
                          </select>
                        ) : (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 text-slate-500 whitespace-nowrap" title={new Date(r.created_at).toLocaleString()}>
                        {formatWhen(r.created_at)}
                      </td>
                      <td className="py-1.5 pl-2 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {(canReview || isOwnerPending) && (
                            <div className="flex items-center gap-1">
                              <SearchableSelect
                                value={reassignTarget[r.id] ?? ""}
                                onChange={(v) => setReassignTarget((prev) => ({ ...prev, [r.id]: v }))}
                                groups={courseGroups}
                                placeholder="Move to course…"
                                className="input text-[11px] py-0.5 w-36"
                              />
                              <button
                                className="text-psu text-[11px] underline disabled:opacity-40"
                                disabled={!reassignTarget[r.id] || reassigning === r.id}
                                onClick={() => reassign(r.id)}
                              >
                                Move
                              </button>
                            </div>
                          )}
                          {(canReview || isOwnerPending) && (
                            <button className="text-red-600 text-[11px] underline" disabled={busyId === r.id} onClick={() => remove(r)}>Remove</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {displayed.length === 0 && (
                  <tr><td colSpan={10} className="py-3 text-slate-400">No recommendations yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
