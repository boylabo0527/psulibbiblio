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

/** Whether a single program_id is within the caller's campus scope --
 *  for mutation/detail endpoints acting on one existing row (a canvassing
 *  entry, a subject, ...) rather than filtering a list. A null program_id
 *  (not yet assigned/triaged) is always allowed, matching the "unknown
 *  campus isn't hidden" policy used when filtering lists of these rows. */
export async function isProgramInScope(
  db: ReturnType<typeof serviceClient>,
  perms: UserPermissions,
  programId: number | null,
): Promise<boolean> {
  if (perms.campusIds === null) return true;
  if (programId == null) return true;
  const allowed = await getAllowedProgramIds(db, perms.campusIds);
  return allowed.has(programId);
}

/** Like isProgramInScope, but for rows that carry a campus_id directly
 *  (purchase_requests, campus_budgets) instead of a program_id to resolve
 *  through program_campuses. A null campus_id (university-wide/digital,
 *  not tied to one physical campus) is always allowed. */
export function isCampusInScope(perms: UserPermissions, campusId: number | null): boolean {
  if (perms.campusIds === null) return true;
  if (campusId == null) return true;
  return perms.campusIds.includes(campusId);
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
