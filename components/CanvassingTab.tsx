"use client";
import { useEffect, useState } from "react";
import { PSU_CAMPUSES } from "@/lib/campuses";
import { apiFetch } from "@/lib/api-client";
import type { CanvassingRow } from "@/app/api/canvassing/route";

type Program = { id: number; name: string };
type Subject = { subject_id: number; course_code: string; course_title: string; program_id: number };

const UNIT_OPTIONS = ["copy", "piece", "set", "volume", "title"];

const BLANK_FORM = {
  title: "", author: "", publisher: "", year: "", isbn: "",
  subject_id: "", program_id: "", supplier: "",
  unit: "copy", stock_prop_no: "", unit_cost: "", quantity: "1", notes: "",
};

const MIGRATION_SQL = `-- Run this once in your Supabase SQL editor:
create table canvassing (
  id bigint generated always as identity primary key,
  title text not null,
  author text, publisher text, year text, isbn text,
  subject_id bigint references subjects(id),
  program_id bigint references programs(id),
  supplier text, unit text default 'copy',
  stock_prop_no text,
  unit_cost numeric(10,2) default 0,
  quantity integer default 1,
  notes text,
  created_at timestamptz default now()
);
alter table canvassing enable row level security;
create policy "service role full access" on canvassing using (true) with check (true);`;

export default function CanvassingTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filterProgram, setFilterProgram] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [rows, setRows] = useState<CanvassingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch("/api/programs").then(r => r.json()).then(j => setPrograms(j.programs ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!filterProgram) { setSubjects([]); setFilterSubject(""); return; }
    apiFetch(`/api/dashboard/subjects?program_id=${filterProgram}`)
      .then(r => r.json()).then(j => setSubjects(j.subjects ?? [])).catch(() => {});
    setFilterSubject("");
  }, [filterProgram]);

  useEffect(() => {
    setLoading(true); setErr(null);
    const p = new URLSearchParams();
    if (filterSubject) p.set("subject_id", filterSubject);
    else if (filterProgram) p.set("program_id", filterProgram);
    apiFetch(`/api/canvassing?${p}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          if (j.error.includes("does not exist") || j.error.includes("relation")) setNeedsMigration(true);
          else setErr(j.error);
        } else {
          setRows(j.rows ?? []);
        }
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filterProgram, filterSubject]);

  function openAdd() {
    setEditId(null);
    setForm({ ...BLANK_FORM, program_id: filterProgram, subject_id: filterSubject });
    setShowForm(true);
  }

  function openEdit(r: CanvassingRow) {
    setEditId(r.id);
    setForm({
      title: r.title, author: r.author, publisher: r.publisher, year: r.year,
      isbn: r.isbn, subject_id: r.subject_id ? String(r.subject_id) : "",
      program_id: r.program_id ? String(r.program_id) : "",
      supplier: r.supplier, unit: r.unit, stock_prop_no: r.stock_prop_no,
      unit_cost: String(r.unit_cost), quantity: String(r.quantity), notes: r.notes,
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    const body = {
      ...form,
      subject_id: form.subject_id ? Number(form.subject_id) : null,
      program_id: form.program_id ? Number(form.program_id) : null,
      unit_cost: Number(form.unit_cost || 0),
      quantity: Number(form.quantity || 1),
      ...(editId ? { id: editId } : {}),
    };
    const res = await apiFetch(`/api/canvassing`, {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    setSaving(false);
    if (j.error) { setErr(j.error); return; }
    setShowForm(false);
    setEditId(null);
    // Refresh
    const p = new URLSearchParams();
    if (filterSubject) p.set("subject_id", filterSubject);
    else if (filterProgram) p.set("program_id", filterProgram);
    apiFetch(`/api/canvassing?${p}`).then(r => r.json()).then(j2 => setRows(j2.rows ?? []));
  }

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await apiFetch(`/api/canvassing?id=${id}`, { method: "DELETE" });
    setRows(r => r.filter(x => x.id !== id));
  }

  const filteredSubjects = filterProgram
    ? subjects
    : [];

  const totalCost = rows.reduce((s, r) => s + r.unit_cost * r.quantity, 0);

  if (needsMigration) {
    return (
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Market Canvassing</h2>
        <p className="text-sm text-amber-700 mb-3">The <code>canvassing</code> table does not exist yet. Run this SQL in your Supabase SQL editor to create it:</p>
        <pre className="bg-slate-900 text-green-300 text-xs rounded p-4 overflow-x-auto whitespace-pre-wrap">{MIGRATION_SQL}</pre>
        <button className="btn-outline mt-4 text-sm" onClick={() => { setNeedsMigration(false); setLoading(true); }}>
          Retry after running migration
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-psu font-semibold">Market Canvassing</h2>
          <button className="btn-outline text-sm" onClick={openAdd}>+ Add Entry</button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[220px]" value={filterProgram} onChange={e => setFilterProgram(e.target.value)}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {filterProgram && (
            <label className="label">
              Subject
              <select className="input ml-1 min-w-[220px]" value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map(s => <option key={s.subject_id} value={s.subject_id}>{s.course_code} — {s.course_title}</option>)}
              </select>
            </label>
          )}
        </div>

        {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
        {loading && <p className="text-slate-500 text-sm">Loading…</p>}

        {/* Add/Edit form */}
        {showForm && (
          <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded space-y-3">
            <h3 className="text-sm font-semibold text-psu">{editId ? "Edit Entry" : "Add Canvassing Entry"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="label flex-col items-start gap-1">
                <span>Title *</span>
                <input className="input w-full" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Author</span>
                <input className="input w-full" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Publisher</span>
                <input className="input w-full" value={form.publisher} onChange={e => setForm(f => ({ ...f, publisher: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Year</span>
                <input className="input w-full" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>ISBN</span>
                <input className="input w-full" value={form.isbn} onChange={e => setForm(f => ({ ...f, isbn: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Supplier / Vendor</span>
                <input className="input w-full" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Program</span>
                <select className="input w-full" value={form.program_id} onChange={e => setForm(f => ({ ...f, program_id: e.target.value, subject_id: "" }))}>
                  <option value="">— none —</option>
                  {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Subject</span>
                <select className="input w-full" value={form.subject_id}
                  onChange={e => setForm(f => ({ ...f, subject_id: e.target.value }))}>
                  <option value="">— none —</option>
                  {filteredSubjects.map(s => <option key={s.subject_id} value={s.subject_id}>{s.course_code} — {s.course_title}</option>)}
                </select>
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Stock / Prop No.</span>
                <input className="input w-full" value={form.stock_prop_no} onChange={e => setForm(f => ({ ...f, stock_prop_no: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Unit</span>
                <select className="input w-full" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Unit Cost (PHP)</span>
                <input className="input w-full" type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1">
                <span>Quantity</span>
                <input className="input w-full" type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
              </label>
              <label className="label flex-col items-start gap-1 sm:col-span-2">
                <span>Notes</span>
                <input className="input w-full" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-outline text-sm" disabled={saving || !form.title.trim()} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button className="text-sm text-slate-500 hover:text-slate-700" onClick={() => { setShowForm(false); setEditId(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {!loading && rows.length === 0 && !showForm && (
          <p className="text-slate-500 text-sm">No canvassing entries yet. Click &quot;Add Entry&quot; to start.</p>
        )}

        {rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="py-1 pr-2">Title</th>
                    <th className="py-1 pr-2">Author</th>
                    <th className="py-1 pr-2">Publisher</th>
                    <th className="py-1 pr-2 text-center">Year</th>
                    <th className="py-1 pr-2">Subject</th>
                    <th className="py-1 pr-2">Supplier</th>
                    <th className="py-1 px-2 text-right">Unit Cost</th>
                    <th className="py-1 px-2 text-right">Qty</th>
                    <th className="py-1 px-2 text-right">Total</th>
                    <th className="py-1 pl-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-1.5 pr-2 font-medium">{r.title}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.author}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.publisher}</td>
                      <td className="py-1.5 pr-2 text-center text-slate-600">{r.year}</td>
                      <td className="py-1.5 pr-2 text-slate-500">{r.subject_label || r.program}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{r.supplier}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">₱{r.unit_cost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="py-1.5 px-2 text-right font-semibold tabular-nums">₱{(r.unit_cost * r.quantity).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</td>
                      <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                        <button className="text-psu text-[11px] underline mr-2" onClick={() => openEdit(r)}>Edit</button>
                        <button className="text-red-500 text-[11px] underline" onClick={() => del(r.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 text-xs font-semibold text-psu mt-2 pt-2 border-t border-slate-200">
              <span>{rows.length} entries</span>
              <span>Total: ₱{totalCost.toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
