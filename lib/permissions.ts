import type { serviceClient } from "./supabase";

export type TabPermission = { can_view: boolean; can_edit: boolean };

export type UserPermissions = {
  email: string;
  role: string | null;
  isAdmin: boolean;
  /** tab_id -> permission. Absent entries mean no access at all. */
  tabs: Record<string, TabPermission>;
};

const ALL_TAB_IDS = [
  "upload", "match", "programs", "campus-validation",
  "procurement", "canvassing", "purchase-request", "activity", "supplier-view",
];

/** Resolves a signed-in user's role and per-tab permissions. Unassigned
 *  emails get no access at all (empty tabs, isAdmin=false) -- an account
 *  existing in Supabase Auth doesn't imply any app permissions until an
 *  admin assigns it a role. */
export async function getUserPermissions(
  db: ReturnType<typeof serviceClient>,
  email: string,
): Promise<UserPermissions> {
  if (!email) return { email, role: null, isAdmin: false, tabs: {} };

  const { data: assignment } = await db
    .from("user_roles")
    .select("role_id, roles(name, is_admin)")
    .eq("email", email)
    .maybeSingle();

  if (!assignment) return { email, role: null, isAdmin: false, tabs: {} };

  const roleInfo = assignment.roles as unknown as { name: string; is_admin: boolean } | null;
  const isAdmin = !!roleInfo?.is_admin;

  if (isAdmin) {
    const tabs: Record<string, TabPermission> = {};
    for (const id of ALL_TAB_IDS) tabs[id] = { can_view: true, can_edit: true };
    return { email, role: roleInfo?.name ?? "Admin", isAdmin: true, tabs };
  }

  const { data: perms } = await db
    .from("role_tab_permissions")
    .select("tab_id, can_view, can_edit")
    .eq("role_id", assignment.role_id);

  const tabs: Record<string, TabPermission> = {};
  for (const p of perms ?? []) {
    tabs[p.tab_id] = { can_view: p.can_view, can_edit: p.can_edit };
  }
  return { email, role: roleInfo?.name ?? null, isAdmin: false, tabs };
}

/** Throws a plain Error (caller should map to a 403 JSON response) unless
 *  the user can edit the given tab. Admins always pass. */
export function assertCanEdit(perms: UserPermissions, tabId: string): void {
  if (perms.isAdmin) return;
  if (!perms.tabs[tabId]?.can_edit) {
    throw new Error(`Your account doesn't have permission to make changes here (${tabId}).`);
  }
}

/** True if the user can edit at least one of the given tabs -- for API
 *  routes whose action is triggered from more than one tab's UI. */
export function canEditAny(perms: UserPermissions, tabIds: string[]): boolean {
  if (perms.isAdmin) return true;
  return tabIds.some((id) => perms.tabs[id]?.can_edit);
}
