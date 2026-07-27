"use client";
import { useCallback, useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";
import { apiFetch } from "@/lib/api-client";
import { useCampuses, useProgramCampusMap } from "@/lib/use-campuses";

type Program = { id: number; name: string };
type Title = {
  id: number; format: ResourceTypeId;
  title: string; author: string; publisher: string; year: string;
  isbn: string; issn: string; call_no: string; copies: number; url?: string;
};
type Buckets = Record<ResourceTypeId, Title[]>;
type SubjectDetail = {
  subject: { id: number; section: string; course_code: string; course_title: string; description: string; locked?: boolean };
  buckets: Buckets;
};
type Bibliography = {
  program: Program;
  campus: string;
  bySection: { section: string; subjects: SubjectDetail[] }[];
};

export default function ProgramsTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [campus, setCampus] = useState<string>("");
  const [fromYear, setFromYear] = useState<string>("");
  const [toYear, setToYear] = useState<string>("");
  const [citationStyle, setCitationStyle] = useState<string>("apa7");
  const [biblio, setBiblio] = useState<Bibliography | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const campuses = useCampuses();
  const { isProgramAtCampus } = useProgramCampusMap();
  const visiblePrograms = campus ? programs.filter((p) => isProgramAtCampus(p.id, campus)) : programs;

  useEffect(() => {
    apiFetch("/api/programs")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.error || `HTTP ${r.status}`); return; }
        setPrograms(j.programs ?? []);
        if (j.programs?.length && selected === null) setSelected(j.programs[0].id);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setErr(null);
    setBiblio(null);
    try {
      const params = new URLSearchParams();
      if (campus) params.set("campus", campus);
      if (fromYear) params.set("from_year", fromYear);
      if (toYear) params.set("to_year", toYear);
      const url = `/api/programs/${selected}/bibliography${params.toString() ? "?" + params.toString() : ""}`;
      const res = await apiFetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(data.error || `HTTP ${res.status}`);
      } else if (!data?.bySection || !data?.program) {
        setErr("Bibliography response missing expected fields.");
      } else {
        setBiblio(data);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [selected, campus, fromYear, toYear]);

  useEffect(() => { load(); }, [load]);

  async function download(fmt: string) {
    if (!selected) return;
    const p = new URLSearchParams({ program_id: String(selected), fmt });
    if (campus) p.set("campus", campus);
    if (fromYear) p.set("from_year", fromYear);
    if (toYear) p.set("to_year", toYear);
    if (fmt.startsWith("citations-")) p.set("style", citationStyle);
    try {
      const res = await apiFetch(`/api/export?${p.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        setErr(text || `HTTP ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const safe = (biblio?.program.name ?? "program").replace(/[^A-Za-z0-9_\-]+/g, "_");
      a.download = `${safe}${campus ? "_" + campus.replace(/[^A-Za-z0-9_\-]+/g, "_") : ""}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeAssignment(subjectId: number, titleId: number, keep: boolean) {
    await apiFetch("/api/match/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject_id: subjectId, title_id: titleId, keep }),
    });
    load();
  }

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Programs</h2>
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[280px]" value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
              {visiblePrograms.length === 0 && <option value="">{campus ? `No programs at ${campus}` : "No programs uploaded yet"}</option>}
              {visiblePrograms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="label">
            Campus
            <select
              className="input ml-1 min-w-[180px]"
              value={campus}
              onChange={(e) => {
                const c = e.target.value;
                setCampus(c);
                if (c && selected !== null) {
                  const cur = programs.find((p) => p.id === selected);
                  if (cur && !isProgramAtCampus(cur.id, c)) {
                    const first = programs.find((p) => isProgramAtCampus(p.id, c));
                    setSelected(first ? first.id : null);
                  }
                }
              }}
            >
              <option value="">All campuses</option>
              {campuses.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="label">
            Year from
            <input
              type="number" className="input ml-1 w-24" placeholder="e.g. 2019"
              value={fromYear} onChange={(e) => setFromYear(e.target.value)}
            />
          </label>
          <label className="label">
            Year to
            <input
              type="number" className="input ml-1 w-24" placeholder="e.g. 2026"
              value={toYear} onChange={(e) => setToYear(e.target.value)}
            />
          </label>
          <span className="text-xs text-slate-500">
            Campus only filters printed materials. Digital resources show for all campuses.
            Year range excludes titles published outside it (blank/unreadable years are always kept).
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">Master report:</span>
          {["xlsx", "csv", "pdf", "docx"].map((fmt) => (
            <button key={fmt} className="btn-outline uppercase text-xs" disabled={!selected} onClick={() => download(fmt)}>
              {fmt}
            </button>
          ))}
          <span className="text-sm text-slate-600 ml-3">Citations:</span>
          <select className="input text-xs" value={citationStyle} onChange={(e) => setCitationStyle(e.target.value)}>
            <option value="apa7">APA 7</option>
            <option value="mla9">MLA 9</option>
            <option value="chicago">Chicago</option>
            <option value="harvard">Harvard</option>
          </select>
          <button className="btn-outline text-xs uppercase" disabled={!selected} onClick={() => download("citations-docx")}>
            DOCX
          </button>
          <button className="btn-outline text-xs uppercase" disabled={!selected} onClick={() => download("citations-txt")}>
            TXT
          </button>
        </div>
      </div>

      {loading && <p className="text-slate-500 text-sm">Loading...</p>}

      {err && (
        <div className="card border-red-300">
          <h2 className="text-red-700 font-semibold mb-1">Couldn't load program</h2>
          <pre className="text-xs text-red-700 whitespace-pre-wrap">{err}</pre>
        </div>
      )}

      {biblio && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-2">
            {biblio.program.name}
            <span className="text-slate-500 font-normal text-sm">
              {biblio.campus ? ` · ${biblio.campus}` : " · All Campuses"}
            </span>
          </h2>
          {biblio.bySection.length === 0 && <p className="text-slate-500 text-sm">No subjects for this program.</p>}
          {biblio.bySection.map((sec) => (
            <div key={sec.section || "_"} className="mb-6">
              {sec.section && <h3 className="text-sm uppercase tracking-wide text-slate-500 mb-2">{sec.section}</h3>}
              {sec.subjects.map((sub) => (
                <SubjectBlock
                  key={sub.subject.id}
                  detail={sub}
                  programCampus={biblio.campus}
                  onRemove={(titleId) => changeAssignment(sub.subject.id, titleId, false)}
                  onAdd={(titleId) => changeAssignment(sub.subject.id, titleId, true)}
                  onReload={load}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SubjectBlock({
  detail, programCampus, onRemove, onAdd, onReload,
}: {
  detail: SubjectDetail;
  programCampus: string;
  onRemove: (titleId: number) => void;
  onAdd: (titleId: number) => void;
  onReload: () => void;
}) {
  const buckets = detail.buckets ?? ({} as Buckets);
  let totalTitles = 0;
  let totalVolumes = 0;
  for (const t of RESOURCE_TYPES) {
    const list = buckets[t.id] ?? [];
    totalTitles += list.length;
    if (t.medium === "print") {
      for (const b of list) totalVolumes += Math.max(1, b.copies ?? 1);
    } else {
      totalVolumes += list.length;
    }
  }

  return (
    <div className={"mb-5 border-l-4 pl-3 " + (detail.subject.locked ? "border-amber-400" : "border-psu-light")}>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{detail.subject.course_code}</span>
        <span className="font-semibold">{detail.subject.course_title}</span>
        <LockToggle subject={detail.subject} onReload={onReload} />
      </div>
      <SubjectDescription subject={detail.subject} />
      {RESOURCE_TYPES.map((t) => (
        <BookSection
          key={t.id}
          label={t.sectionLabel}
          books={buckets[t.id] ?? []}
          onRemove={onRemove}
          onReload={onReload}
          showIdent={t.medium === "print" || t.kind === "journal"}
        />
      ))}
      <p className="text-xs text-slate-700 mt-1">
        <strong>Titles:</strong> {totalTitles} · <strong>Volumes:</strong> {totalVolumes}
      </p>
      <AddBook subjectId={detail.subject.id} programCampus={programCampus} onAdded={onAdd} />
    </div>
  );
}

function LockToggle({
  subject, onReload,
}: {
  subject: { id: number; locked?: boolean };
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const locked = !!subject.locked;

  async function toggle() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: !locked }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      onReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <button
      className={
        "text-[10px] px-1.5 py-0.5 rounded border font-medium " +
        (locked
          ? "bg-amber-100 text-amber-700 border-amber-300"
          : "text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600")
      }
      disabled={busy}
      onClick={toggle}
      title={locked
        ? "Locked — Run Matching will skip this subject and leave its titles untouched. Click to unlock."
        : "Lock this subject so Run Matching never changes its title list. Click to lock."}
    >
      {locked ? "🔒 Locked" : "🔓 Unlocked"}
    </button>
  );
}

function SubjectDescription({
  subject,
}: {
  subject: { id: number; course_code: string; course_title: string; description: string };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(subject.description ?? "");
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState(subject.description ?? "");
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: draft, _tab: "programs" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setText(draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className="mb-2">
        <textarea
          className="input w-full text-xs leading-relaxed"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2 mt-1">
          <button className="btn text-xs" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="btn-outline text-xs" disabled={saving} onClick={() => { setDraft(text); setEditing(false); }}>
            Cancel
          </button>
          {err && <span className="text-red-700 text-xs self-center">{err}</span>}
        </div>
      </div>
    );
  }

  return (
    <p
      className="text-xs text-slate-600 mb-2 leading-relaxed cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1"
      title="Click to edit description"
      onClick={() => { setDraft(text); setEditing(true); }}
    >
      {text || <span className="italic text-slate-400">Click to add a description…</span>}
    </p>
  );
}

function BookSection({
  label, books, onRemove, onReload, showIdent,
}: { label: string; books: Title[]; onRemove: (id: number) => void; onReload: () => void; showIdent: boolean }) {
  if (!books.length) return null;
  return (
    <div className="mb-2">
      <div className="text-xs italic text-slate-700 mb-1">{label}</div>
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            {showIdent && <th className="text-left p-1 w-32">Call No. / ISSN</th>}
            <th className="text-left p-1 w-44">Author</th>
            <th className="text-left p-1">Title</th>
            <th className="text-left p-1 w-32">Publisher</th>
            <th className="text-left p-1 w-12">Year</th>
            <th className="text-left p-1 w-12">Copy</th>
            <th className="p-1 w-20"></th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <EditableTitleRow key={b.id} book={b} siblings={books} showIdent={showIdent} onRemove={onRemove} onReload={onReload} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditableTitleRow({
  book, siblings, showIdent, onRemove, onReload,
}: { book: Title; siblings: Title[]; showIdent: boolean; onRemove: (id: number) => void; onReload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<Title>(book);
  const [draft, setDraft] = useState<Title>(book);
  const [err, setErr] = useState<string | null>(null);
  const [combining, setCombining] = useState(false);
  const [combineTarget, setCombineTarget] = useState("");
  const [combineBusy, setCombineBusy] = useState(false);

  async function combine() {
    if (!combineTarget) return;
    const target = siblings.find((s) => s.id === Number(combineTarget));
    if (!confirm(`Combine "${book.title}" into "${target?.title ?? ""}"? Copies are summed and this row is removed.`)) return;
    setCombineBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/titles/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: book.id, target_id: Number(combineTarget) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      onReload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setCombineBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/titles/${book.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_no: draft.call_no, issn: draft.issn, author: draft.author,
          title: draft.title, publisher: draft.publisher, year: draft.year,
          copies: Number(draft.copies) || 1,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      if (j.merged) {
        // This row was merged into an existing duplicate — its copy count
        // moved elsewhere, so refetch rather than patching local state.
        onReload();
        return;
      }
      setLocal(draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <tr className="border-t border-slate-100 bg-amber-50">
        {showIdent && (
          <td className="p-1">
            <input className="input text-xs w-full" value={draft.call_no ?? draft.issn ?? ""}
              onChange={(e) => setDraft({ ...draft, call_no: e.target.value, issn: draft.issn })} />
          </td>
        )}
        <td className="p-1"><input className="input text-xs w-full" value={draft.author ?? ""} onChange={(e) => setDraft({ ...draft, author: e.target.value })} /></td>
        <td className="p-1"><input className="input text-xs w-full" value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></td>
        <td className="p-1"><input className="input text-xs w-full" value={draft.publisher ?? ""} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })} /></td>
        <td className="p-1"><input className="input text-xs w-full" value={draft.year ?? ""} onChange={(e) => setDraft({ ...draft, year: e.target.value })} /></td>
        <td className="p-1"><input type="number" min={1} className="input text-xs w-full" value={draft.copies ?? 1} onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value) })} /></td>
        <td className="p-1">
          <div className="flex gap-1">
            <button className="text-psu text-xs" disabled={saving} onClick={save}>{saving ? "…" : "save"}</button>
            <button className="text-slate-500 text-xs" disabled={saving} onClick={() => { setDraft(local); setEditing(false); }}>cancel</button>
          </div>
          {err && <div className="text-red-600 text-[10px]">{err}</div>}
        </td>
      </tr>
    );
  }

  const others = siblings.filter((s) => s.id !== book.id);

  return (
    <>
      <tr className="border-t border-slate-100">
        {showIdent && <td className="p-1">{local.call_no || local.issn}</td>}
        <td className="p-1">{local.author}</td>
        <td className="p-1">
          {local.title}
          {local.url && (
            <a href={local.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-psu" title={local.url}>
              🔗
            </a>
          )}
        </td>
        <td className="p-1">{local.publisher}</td>
        <td className="p-1">{local.year}</td>
        <td className="p-1">{local.copies ?? 1}</td>
        <td className="p-1">
          <div className="flex gap-2">
            <button className="text-psu text-xs" onClick={() => { setDraft(local); setEditing(true); }}>edit</button>
            {others.length > 0 && (
              <button className="text-slate-500 text-xs" onClick={() => setCombining((v) => !v)}>combine</button>
            )}
            <button className="text-red-600 text-xs" onClick={() => onRemove(book.id)}>remove</button>
          </div>
        </td>
      </tr>
      {combining && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={showIdent ? 6 : 5} className="p-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Combine this into:</span>
              <select className="input text-xs" value={combineTarget} onChange={(e) => setCombineTarget(e.target.value)}>
                <option value="">— select title —</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>{o.title} {o.author ? `— ${o.author}` : ""}</option>
                ))}
              </select>
              <button className="text-psu text-xs" disabled={combineBusy || !combineTarget} onClick={combine}>
                {combineBusy ? "…" : "Combine"}
              </button>
              <button className="text-slate-400 text-xs" onClick={() => setCombining(false)}>cancel</button>
              {err && <span className="text-red-600 text-xs">{err}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddBook({
  subjectId, programCampus, onAdded,
}: { subjectId: number; programCampus: string; onAdded: (titleId: number) => void }) {
  const [q, setQ] = useState("");
  const [format, setFormat] = useState<"" | ResourceTypeId>("");
  const [hits, setHits] = useState<Title[]>([]);
  const [open, setOpen] = useState(false);

  async function search() {
    if (!q.trim()) { setHits([]); return; }
    const params = new URLSearchParams({ q });
    if (format) params.set("format", format);
    if (programCampus) params.set("campus", programCampus);
    const data = await apiFetch(`/api/titles/search?${params}`).then((r) => r.json());
    setHits(data.titles ?? []);
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button className="text-xs text-psu" onClick={() => setOpen(true)}>+ add resource to {subjectId}</button>
      ) : (
        <div className="bg-slate-50 rounded p-2">
          <div className="flex flex-wrap gap-2 mb-2">
            <input className="input text-xs flex-1 min-w-[180px]" placeholder="Search title..." value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            <select className="input text-xs" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="">Any type</option>
              {RESOURCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.uiLabel}</option>)}
            </select>
            <button className="btn text-xs" onClick={search}>Search</button>
            <button className="btn-outline text-xs" onClick={() => setOpen(false)}>Close</button>
          </div>
          <ul className="text-xs max-h-40 overflow-auto">
            {hits.map((t) => (
              <li key={t.id} className="py-0.5 flex justify-between gap-2">
                <span>
                  <span className="text-slate-500 mr-1">[{t.format}]</span>
                  {t.author ? `${t.author} — ` : ""}{t.title}
                  {t.year ? ` (${t.year})` : ""}
                </span>
                <button className="text-psu underline" onClick={() => onAdded(t.id)}>add</button>
              </li>
            ))}
            {q && hits.length === 0 && <li className="text-slate-500 py-1">No matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
