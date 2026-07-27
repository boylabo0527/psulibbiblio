import type { serviceClient } from "./supabase";
import type { UserPermissions } from "./permissions";

/** Program ids offered at ANY of the given campuses. A program can be
 *  offered at several campuses at once (program_campuses is many-to-many),
 *  so a campus-restricted user still sees a shared program's subjects --
 *  restriction means "at least my campus," not "only my campus." */
export async function getAllowedProgramIds(
  db: ReturnType<typeof serviceClient>,
  campusIds: number[],
): Promise<Set<number>> {
  if (!campusIds.length) return new Set();
  const { data, error } = await db.from("program_campuses").select("program_id").in("campus_id", campusIds);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.program_id as number));
}

/** Narrows a requested program_id against the caller's campus scope.
 *  Returns { ok: true, programIds: null } when unrestricted (no filtering
 *  needed), { ok: true, programIds: Set } when restricted and the request
 *  is within scope (or no specific program was requested, so filter to the
 *  allowed set), or { ok: false } when a specific program_id was requested
 *  that the caller isn't allowed to see. */
export async function resolveProgramScope(
  db: ReturnType<typeof serviceClient>,
  perms: UserPermissions,
  requestedProgramId: number | null,
): Promise<{ ok: true; programIds: Set<number> | null } | { ok: false }> {
  if (perms.campusIds === null) return { ok: true, programIds: null };
  const allowed = await getAllowedProgramIds(db, perms.campusIds);
  if (requestedProgramId != null && !allowed.has(requestedProgramId)) return { ok: false };
  return { ok: true, programIds: allowed };
}
