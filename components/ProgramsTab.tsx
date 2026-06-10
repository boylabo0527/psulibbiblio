"use client";
import { useCallback, useEffect, useState } from "react";

type Program = { id: number; name: string; campus: string; college: string };
type Title = {
  id: number; format: "ebook" | "printed";
  title: string; author: string; publisher: string; year: string;
  isbn: string; call_no: string; copies: number;
};
type SubjectDetail = {
  subject: { id: number; section: string; course_code: string; course_title: string; description: string };
  ebooks: Title[];
  printed: Title[];
};
type Bibliography = {
  program: Program;
  bySection: { section: string; subjects: SubjectDetail[] }[];
};

export default function ProgramsTab() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [biblio, setBiblio] = useState<Bibliography | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/programs").then((r) => r.json()).then((d) => {
      setPrograms(d.programs ?? []);
      if (d.programs?.length && selected === null) setSelected(d.programs[0].id);
    }).catch(() => {});
  }, [selected]);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await fetch(`/api/programs/${selected}/bibliography`).then((r) => r.json());
      setBiblio(data);
    } finally { setLoading(false); }
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  function download(fmt: string) {
    if (!selected) return;
    window.location.href = `/api/export?program_id=${selected}&fmt=${fmt}`;
  }

  async function removeAssignment(subjectId: number, titleId: number) {
    await fetch("/api/match/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject_id: subjectId, title_id: titleId, keep: false }),
    });
    load();
  }

  async function addAssignment(subjectId: number, titleId: number) {
    await fetch("/api/match/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject_id: subjectId, title_id: titleId, keep: true }),
    });
    load();
  }

  return (
    <>
      <div className="card">
        <h2 className="text-psu font-semibold mb-2">Programs</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="label">
            Program
            <select className="input ml-1 min-w-[280px]" value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
              {programs.length === 0 && <option value="">No programs uploaded yet</option>}
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.campus ? ` — ${p.campus}` : ""}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-slate-600">Export this program's bibliography:</span>
          {["xlsx", "csv", "pdf", "docx"].map((fmt) => (
            <button key={fmt} className="btn-outline uppercase text-xs" disabled={!selected} onClick={() => download(fmt)}>
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-slate-500 text-sm">Loading...</p>}

      {biblio && (
        <div className="card">
          <h2 className="text-psu font-semibold mb-2">
            {biblio.program.name}
            <span className="text-slate-500 font-normal text-sm">
              {biblio.program.campus ? ` · ${biblio.program.campus}` : ""}
              {biblio.program.college ? ` · ${biblio.program.college}` : ""}
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
                  onRemove={(titleId) => removeAssignment(sub.subject.id, titleId)}
                  onAdd={(titleId) => addAssignment(sub.subject.id, titleId)}
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
  detail, onRemove, onAdd,
}: { detail: SubjectDetail; onRemove: (titleId: number) => void; onAdd: (titleId: number) => void }) {
  const print = detail.printed.reduce((acc, t) => ({ titles: acc.titles + 1, volumes: acc.volumes + (t.copies || 1) }), { titles: 0, volumes: 0 });
  const ebook = { titles: detail.ebooks.length, volumes: detail.ebooks.length };
  return (
    <div className="mb-5 border-l-4 border-psu-light pl-3">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{detail.subject.course_code}</span>
        <span className="font-semibold">{detail.subject.course_title}</span>
      </div>
      {detail.subject.description && (
        <p className="text-xs text-slate-600 mb-2 leading-relaxed">{detail.subject.description}</p>
      )}
      <BookSection
        label="eBooks (Kavita)"
        books={detail.ebooks}
        onRemove={onRemove}
        showCallNo={false}
      />
      <BookSection
        label="Printed Books"
        books={detail.printed}
        onRemove={onRemove}
        showCallNo={true}
      />
      <p className="text-xs text-slate-700 mt-1">
        <strong>Titles:</strong> {print.titles + ebook.titles}
        {" · "}
        <strong>Volumes:</strong> {print.volumes + ebook.volumes}
      </p>
      <AddBook subjectId={detail.subject.id} onAdded={onAdd} />
    </div>
  );
}

function BookSection({
  label, books, onRemove, showCallNo,
}: { label: string; books: Title[]; onRemove: (id: number) => void; showCallNo: boolean }) {
  if (!books.length) return null;
  return (
    <div className="mb-2">
      <div className="text-xs italic text-slate-700 mb-1">{label}</div>
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            {showCallNo && <th className="text-left p-1 w-32">Call No.</th>}
            <th className="text-left p-1 w-44">Author</th>
            <th className="text-left p-1">Title</th>
            <th className="text-left p-1 w-12">Year</th>
            <th className="text-left p-1 w-12">Copy</th>
            <th className="p-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} className="border-t border-slate-100">
              {showCallNo && <td className="p-1">{b.call_no}</td>}
              <td className="p-1">{b.author}</td>
              <td className="p-1">{b.title}</td>
              <td className="p-1">{b.year}</td>
              <td className="p-1">{b.copies ?? 1}</td>
              <td className="p-1">
                <button className="text-red-600 text-xs" onClick={() => onRemove(b.id)}>remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddBook({ subjectId, onAdded }: { subjectId: number; onAdded: (titleId: number) => void }) {
  const [q, setQ] = useState("");
  const [format, setFormat] = useState<"" | "ebook" | "printed">("");
  const [hits, setHits] = useState<Title[]>([]);
  const [open, setOpen] = useState(false);

  async function search() {
    if (!q.trim()) { setHits([]); return; }
    const params = new URLSearchParams({ q });
    if (format) params.set("format", format);
    const data = await fetch(`/api/titles/search?${params}`).then((r) => r.json());
    setHits(data.titles ?? []);
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button className="text-xs text-psu" onClick={() => setOpen(true)}>+ add book to {subjectId}</button>
      ) : (
        <div className="bg-slate-50 rounded p-2">
          <div className="flex flex-wrap gap-2 mb-2">
            <input className="input text-xs flex-1 min-w-[180px]" placeholder="Search title..." value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
            <select className="input text-xs" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="">Any format</option>
              <option value="ebook">eBook</option>
              <option value="printed">Printed</option>
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
