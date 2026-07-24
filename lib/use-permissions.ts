"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import { useAuth } from "@/components/AuthProvider";

export type TabPermission = { can_view: boolean; can_edit: boolean };
export type Permissions = {
  email: string;
  role: string | null;
  isAdmin: boolean;
  tabs: Record<string, TabPermission>;
  /** null = unrestricted (sees every campus). Non-null = restricted to
   *  exactly these campus ids, set by an admin in User Management. */
  campusIds: number[] | null;
  campusNames: string[];
};

const EMPTY: Permissions = { email: "", role: null, isAdmin: false, tabs: {}, campusIds: null, campusNames: [] };

/** Fetches the signed-in user's role/tab permissions once per session.
 *  Returns EMPTY (no access to anything but the public Dashboard) while
 *  loading or if the user isn't signed in / has no role assigned. */
export function usePermissions(): { perms: Permissions; loading: boolean } {
  const { user } = useAuth();
  const [perms, setPerms] = useState<Permissions>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setPerms(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch("/api/me/permissions")
      .then((r) => r.json())
      .then((j) => setPerms(j.error ? EMPTY : j))
      .catch(() => setPerms(EMPTY))
      .finally(() => setLoading(false));
  }, [user]);

  return { perms, loading };
}

/** True if the role can at least view the tab, OR is an admin. */
export function canView(perms: Permissions, tabId: string): boolean {
  return perms.isAdmin || !!perms.tabs[tabId]?.can_view;
}

/** True if the role can edit within the tab, OR is an admin. */
export function canEdit(perms: Permissions, tabId: string): boolean {
  return perms.isAdmin || !!perms.tabs[tabId]?.can_edit;
}
