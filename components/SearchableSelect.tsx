"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectOption = { value: string; label: string };
export type SearchableSelectGroup = { label: string; options: SearchableSelectOption[] };

/** Type-to-filter dropdown -- a plain &lt;select&gt; with dozens/hundreds of
 *  grouped options (e.g. every course across every program) has no way to
 *  jump to what you're looking for except scrolling, which is exactly the
 *  "hard to search" complaint this replaces. Click or focus opens a list
 *  filtered live as you type against each option's label; arrow keys +
 *  Enter work too. Controlled the same way a &lt;select&gt; is (value + onChange). */
export default function SearchableSelect({
  value, onChange, groups, placeholder, className,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: SearchableSelectGroup[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allOptions = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const selected = allOptions.find((o) => o.value === value) ?? null;

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, options: g.options.filter((o) => o.label.toLowerCase().includes(q)) }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);
  const flatFiltered = useMemo(() => filteredGroups.flatMap((g) => g.options), [filteredGroups]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  useEffect(() => { setHighlight(0); }, [query, open]);

  function pick(opt: SearchableSelectOption) {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, flatFiltered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flatFiltered[highlight]) pick(flatFiltered[highlight]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        className={className ?? "input w-full"}
        placeholder={placeholder ?? "Type to search…"}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="absolute left-0 top-full z-20 mt-0.5 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg py-1">
          {flatFiltered.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No matches.</div>}
          {filteredGroups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
              {g.options.map((o) => {
                const flatIdx = flatFiltered.indexOf(o);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={
                      "w-full text-left px-3 py-1.5 text-sm whitespace-nowrap overflow-hidden text-ellipsis " +
                      (flatIdx === highlight ? "bg-psu-light text-psu" : "text-slate-700 hover:bg-slate-50") +
                      (o.value === value ? " font-semibold" : "")
                    }
                    onMouseEnter={() => setHighlight(flatIdx)}
                    onClick={() => pick(o)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
