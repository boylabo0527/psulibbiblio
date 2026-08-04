"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Title = {
  id: number; source_id: number; title: string; author: string; publisher: string;
  year: string; isbn: string; url?: string; subjects?: string; provider: string;
};

/** Browses/searches the eBook titles moved out of Supabase to the
 *  library's Hostinger MySQL database once they'd never been assigned to
 *  any course (see the Migrate Unmatched eBooks admin tool on the Upload
 *  tab, and lib/hostinger-mysql.ts). Read-only -- this is an archive to
 *  look things up in, not a catalog to manage from here. */
export default function PerlegoCatalogTab() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Title[]>([]);
  const [total, setTotal] = useState(0);
  const [totalArchived, setTotalArchived] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set("q", q.trim());
    apiFetch(`/api/hostinger/titles?${p}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setErr(j.error); return; }
        setRows(j.rows ?? []);
        setTotal(j.total ?? 0);
        setTotalArchived(j.totalArchived ?? null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [q, page]);

  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="card">
      <h2 className="text-psu font-semibold mb-1">Perlego Catalog (archived)</h2>
      <p className="text-xs text-slate-500 mb-3">
        eBook titles moved out of the main catalog because they&apos;d never been assigned to a course --
        {totalArchived != null ? ` ${totalArchived.toLocaleString()} archived here.` : ""} Search and view only;
        not part of Match&apos;s candidate pool. If you need one of these for a program, re-upload it from your
        Perlego export under Upload &gt; Subscribed eBooks and it&apos;ll be a normal catalog title again.
      </p>

      <input
        className="input w-full max-w-md mb-3"
        placeholder="Search by title, author, or ISBN…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPage(1); }}
      />

      {err && <p className="text-red-700 text-sm mb-3">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {!loading && !err && (
        <>
          <p className="text-xs text-slate-500 mb-2">{total.toLocaleString()} match{total === 1 ? "" : "es"}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Author</th>
                  <th className="py-1 pr-2">Publisher</th>
                  <th className="py-1 pr-2">Year</th>
                  <th className="py-1 pr-2">ISBN</th>
                  <th className="py-1 pr-2">Provider</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1 pr-2">
                      {r.title}
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-psu" title={r.url}>🔗</a>
                      )}
                    </td>
                    <td className="py-1 pr-2">{r.author}</td>
                    <td className="py-1 pr-2">{r.publisher}</td>
                    <td className="py-1 pr-2">{r.year}</td>
                    <td className="py-1 pr-2">{r.isbn}</td>
                    <td className="py-1 pr-2">{r.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="text-slate-500 text-sm mt-2">No matches.</p>}

          {pageCount > 1 && (
            <div className="flex items-center gap-2 mt-3 text-xs">
              <button className="btn-outline text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="text-slate-500">Page {page} of {pageCount.toLocaleString()}</span>
              <button className="btn-outline text-xs" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
