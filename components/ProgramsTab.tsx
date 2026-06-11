"use client";
import { useCallback, useEffect, useState } from "react";
import { RESOURCE_TYPES, type ResourceTypeId } from "@/lib/resources";

type Program = { id: number; name: string };
type Title = {
  id: number; format: ResourceTypeId;
  title: string; author: string; publisher: string; year: string;
  isbn: string; issn: string; call_no: string; copies: number;
};
type Buckets = Record<ResourceTypeId, Title[]>;
type SubjectDetail = {
  subject: { id: number; section: string; course_code: string; course_title: string; description: string };
  buckets: Buckets;
};
type Bibliography = {
  program: Program;
  campus: string;
  bySection: { section: string; subjects: SubjectDetail[] }[];
};

export default function ProgramsTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [campuses, setCampuses] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [campus, setCampus] = useState<string>("");
  const [biblio, setBiblio] = useState<Bibliography | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fetch the list of campuses that appear on printed-resource rows so the
  // picker doesn't require the librarian to remember exact spellings.
  useEffect(() => {
    fetch("/api/campuses")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok) setCampuses(j.campuses ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/programs")
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
      const url = `/api/programs/${selected}/bibliography${params.toString() ? "?" + params.toString() : ""}`;
      const res = await fetch(url);
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
  }, [selected, campus]);

  useEffect(() => { load(); }, [load]);

  function download(fmt: string) {
    if (!selected) return;
    const p = new URLSearchParams({ program_id: String(selected), fmt });
    if (campus) p.set("campus", campus);
    window.location.href = `/api/export?${p.toString()}`;
  }

  async function changeAssignment(subjectId: number, titleId: number, keep: boolean) {
    await fetch("/api/match/override", {
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
              {programs.length === 0 && <option value="">No programs uploaded yet</option>}
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="label">
            Campus
            <input
              className="input ml-1 min-w-[180px]"
              list="campuses-list"
              placeholder="All campuses"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
            />
            <datalist id="campuses-list">
              {campuses.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <span className="text-xs text-slate-500">
            Campus only filters printed materials. Digital resources show for all campuses.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">Export this program's bibliography:</span>
          {["xlsx", "csv", "pdf", "docx"].map((fmt) => (
            <button key={fmt} className="btn-outline uppercase text-xs" disabled={!selected} onClick={() => download(fmt)}>
              {fmt}
            </button>
          ))}
          <button
            className="btn-outline text-xs"
            disabled={!selected}
            onClick={() => download("citations")}
            title="Download APA 7 reference list (.docx)"
          >
            Citations (APA 7)
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
                  onSaved={load}
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
  detail, programCampus, onRemove, onAdd, onSaved,
}: {
  detail: SubjectDetail;
  programCampus: string;
  onRemove: (titleId: number) => void;
  onAdd: (titleId: number) => void;
  onSaved: () => void;
}) {
  const buckets = detail.buckets ?? ({} as Buckets);
  let totalTitles = 0;
  let totalVolumes = 0;
  // Volumes are a print-only count (= number of copies). Digital titles
  // (eBooks, online journals) don't contribute volumes.
  for (const t of RESOURCE_TYPES) {
    const list = buckets[t.id] ?? [];
    totalTitles += list.length;
    if (t.medium === "print") {
      for (const b of list) totalVolumes += Math.max(1, b.copies ?? 1);
    }
  }

  return (
    <div className="mb-5 border-l-4 border-psu-light pl-3">
      <SubjectHeader subject={detail.subject} onSaved={onSaved} />
      {RESOURCE_TYPES.map((t) => (
        <BookSection
          key={t.id}
          label={t.sectionLabel}
          books={buckets[t.id] ?? []}
          onRemove={onRemove}
          onEdited={onSaved}
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

function SubjectHeader({
  subject, onSaved,
}: {
  subject: SubjectDetail["subject"];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(subject.course_code || "");
  const [title, setTitle] = useState(subject.course_title || "");
  const [description, setDescription] = useState(subject.description || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setCode(subject.course_code || "");
    setTitle(subject.course_title || "");
    setDescription(subject.description || "");
  }, [subject.course_code, subject.course_title, subject.description]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course_code: code, course_title: title, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setCode(subject.course_code || "");
    setTitle(subject.course_title || "");
    setDescription(subject.description || "");
    setErr(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <>
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{subject.course_code}</span>
          <span className="font-semibold">{subject.course_title}</span>
          <button
            className="text-[11px] text-psu underline ml-1"
            onClick={() => setEditing(true)}
            title="Fix typos in course code, title, or description"
          >
            edit
          </button>
        </div>
        {subject.description && (
          <p className="text-xs text-slate-600 mb-2 leading-relaxed">{subject.description}</p>
        )}
      </>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2 mb-2 space-y-2">
      <div className="flex gap-2">
        <input
          className="input text-xs w-32"
          placeholder="Course code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          className="input text-xs flex-1"
          placeholder="Course title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <textarea
        className="input text-xs w-full"
        placeholder="Course description"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button className="btn text-xs" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn-outline text-xs" disabled={saving} onClick={cancel}>Cancel</button>
        <span className="text-[11px] text-slate-500 self-center">
          Re-run Match if the description change should affect book assignments.
        </span>
      </div>
    </div>
  );
}

function BookSection({
  label, books, onRemove, onEdited, showIdent,
}: {
  label: string;
  books: Title[];
  onRemove: (id: number) => void;
  onEdited: () => void;
  showIdent: boolean;
}) {
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
            <th className="text-left p-1 w-12">Year</th>
            <th className="text-left p-1 w-12">Copy</th>
            <th className="p-1 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              showIdent={showIdent}
              onRemove={onRemove}
              onSaved={onEdited}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookRow({
  book, showIdent, onRemove, onSaved,
}: {
  book: Title;
  showIdent: boolean;
  onRemove: (id: number) => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [ident, setIdent] = useState(book.call_no || book.issn || "");
  const [author, setAuthor] = useState(book.author || "");
  const [title, setTitle] = useState(book.title || "");
  const [year, setYear] = useState(book.year || "");
  const [copies, setCopies] = useState(String(book.copies ?? 1));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setIdent(book.call_no || book.issn || "");
    setAuthor(book.author || "");
    setTitle(book.title || "");
    setYear(book.year || "");
    setCopies(String(book.copies ?? 1));
  }, [book.call_no, book.issn, book.author, book.title, book.year, book.copies]);

  // The Call No. / ISSN cell shows whichever the row has. When the user
  // edits it, route the new value back to the same field they were viewing
  // (call_no for printed, issn for journals).
  const identField: "call_no" | "issn" = book.call_no ? "call_no" : book.issn ? "issn" : "call_no";

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, string | number> = {
        author, title, year,
        copies: Math.max(0, parseInt(copies, 10) || 0),
      };
      if (showIdent) payload[identField] = ident;
      const res = await fetch(`/api/titles/${book.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setIdent(book.call_no || book.issn || "");
    setAuthor(book.author || "");
    setTitle(book.title || "");
    setYear(book.year || "");
    setCopies(String(book.copies ?? 1));
    setErr(null);
    setEditing(false);
  }

  if (editing) {
    return (
      <>
        <tr className="border-t border-slate-100 bg-slate-50">
          {showIdent && (
            <td className="p-1">
              <input className="input text-xs w-full" value={ident} onChange={(e) => setIdent(e.target.value)} />
            </td>
          )}
          <td className="p-1">
            <input className="input text-xs w-full" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </td>
          <td className="p-1">
            <input className="input text-xs w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </td>
          <td className="p-1">
            <input className="input text-xs w-full" value={year} onChange={(e) => setYear(e.target.value)} />
          </td>
          <td className="p-1">
            <input
              className="input text-xs w-full"
              type="number"
              min={0}
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
            />
          </td>
          <td className="p-1 text-right whitespace-nowrap">
            <button className="text-psu text-xs mr-1" disabled={saving} onClick={save}>
              {saving ? "…" : "save"}
            </button>
            <button className="text-slate-500 text-xs" disabled={saving} onClick={cancel}>cancel</button>
          </td>
        </tr>
        {err && (
          <tr className="bg-slate-50">
            <td colSpan={showIdent ? 6 : 5} className="px-1 pb-1 text-xs text-red-600">{err}</td>
          </tr>
        )}
      </>
    );
  }

  return (
    <tr className="border-t border-slate-100">
      {showIdent && <td className="p-1">{book.call_no || book.issn}</td>}
      <td className="p-1">{book.author}</td>
      <td className="p-1">{book.title}</td>
      <td className="p-1">{book.year}</td>
      <td className="p-1">{book.copies ?? 1}</td>
      <td className="p-1 text-right whitespace-nowrap">
        <button className="text-psu text-xs mr-2" onClick={() => setEditing(true)}>edit</button>
        <button className="text-red-600 text-xs" onClick={() => onRemove(book.id)}>remove</button>
      </td>
    </tr>
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
    const data = await fetch(`/api/titles/search?${params}`).then((r) => r.json());
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
