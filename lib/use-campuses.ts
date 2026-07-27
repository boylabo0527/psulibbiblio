"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";

export type Campus = { id: number; name: string };

/** Fetches the database-managed campus list (replaces the old hardcoded PSU_CAMPUSES). */
export function useCampuses(): Campus[] {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  useEffect(() => {
    apiFetch("/api/campuses")
      .then((r) => r.json())
      .then((j) => setCampuses(j.campuses ?? []))
      .catch(() => {});
  }, []);
  return campuses;
}

/** Fetches which campuses offer which program, keyed by program id.
 *  A program with no rows at all is treated as offered everywhere (unmapped
 *  programs shouldn't silently disappear from campus-filtered views). */
export function useProgramCampusMap(): {
  loaded: boolean;
  isProgramAtCampus: (programId: number, campus: string) => boolean;
} {
  const [map, setMap] = useState<Map<number, Set<string>> | null>(null);
  useEffect(() => {
    apiFetch("/api/program-campuses")
      .then((r) => r.json())
      .then((j) => {
        const m = new Map<number, Set<string>>();
        for (const row of (j.mappings ?? []) as { program_id: number; campus_name: string }[]) {
          if (!m.has(row.program_id)) m.set(row.program_id, new Set());
          m.get(row.program_id)!.add(row.campus_name);
        }
        setMap(m);
      })
      .catch(() => setMap(new Map()));
  }, []);

  return {
    loaded: map !== null,
    isProgramAtCampus: (programId: number, campus: string) => {
      if (!campus) return true;
      const set = map?.get(programId);
      if (!set) return true; // no mapping configured yet — don't hide it
      return set.has(campus);
    },
  };
}
