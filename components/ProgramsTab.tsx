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
  detail, programCampus, onRemove, onAdd,
}: {
  detail: SubjectDetail;
  programCampus: string;
  onRemove: (titleId: number) => void;
  onAdd: (titleId: number) => void;
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
    <div className="mb-5 border-l-4 border-psu-light pl-3">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold">{detail.subject.course_code}</span>
        <span className="font-semibold">{detail.subject.course_title}</span>
      </div>
      {detail.subject.description && (
        <p className="text-xs text-slate-600 mb-2 leading-relaxed">{detail.subject.description}</p>
      )}
      {RESOURCE_TYPES.map((t) => (
        <BookSection
          key={t.id}
          label={t.sectionLabel}
          books={buckets[t.id] ?? []}
          onRemove={onRemove}
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

function BookSection({
  label, books, onRemove, showIdent,
}: { label: string; books: Title[]; onRemove: (id: number) => void; showIdent: boolean }) {
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
            <th className="p-1 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} className="border-t border-slate-100">
              {showIdent && <td className="p-1">{b.call_no || b.issn}</td>}
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
