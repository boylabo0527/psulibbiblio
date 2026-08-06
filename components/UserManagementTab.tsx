"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Perm = { can_view: boolean; can_edit: boolean };
type Role = {
  id: number;
  name: string;
  is_admin: boolean;
  permissions: Record<string, Perm>;
};
type UserAssignment = { email: string; role_id: number; role_name: string | null; is_admin: boolean; created_at: string };
type Campus = { id: number; name: string };

const TAB_LABELS: Record<string, string> = {
  upload: "Upload",
  match: "Match",
  programs: "Programs & Export",
  "campus-validation": "Campus Validation",
  procurement: "Procurement Analysis",
  "standard-titles": "Standard Titles",
  canvassing: "Market Canvassing",
  "purchase-request": "Purchase Request",
  activity: "Activity Log",
  "supplier-view": "Supplier View",
  "supplier-directory": "Supplier Directory",
  monitoring: "Monitoring",
  "faculty-recommendations": "Faculty Recommendations",
};
const TAB_IDS = Object.keys(TAB_LABELS);

// draft[roleId][tabId] -- edited locally; nothing is sent to the server
// until "Save changes" is clicked.
type Draft = Record<number, Record<string, Perm>>;

function draftFromRoles(roles: Role[]): Draft {
  const d: Draft = {};
  for (const r of roles) {
    d[r.id] = {};
    for (const tabId of TAB_IDS) {
      d[r.id][tabId] = { ...(r.permissions[tabId] ?? { can_view: false, can_edit: false }) };
    }
  }
  return d;
}

export default function UserManagementTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [users, setUsers] = useState<UserAssignment[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [userCampuses, setUserCampuses] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRoleId, setNewUserRoleId] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [rolesRes, usersRes, campusesRes, userCampusesRes] = await Promise.all([
        apiFetch("/api/admin/roles").then((r) => r.json()),
        apiFetch("/api/admin/users").then((r) => r.json()),
        apiFetch("/api/campuses").then((r) => r.json()),
        apiFetch("/api/admin/user-campuses").then((r) => r.json()),
      ]);
      if (rolesRes.error) throw new Error(rolesRes.error);
      if (usersRes.error) throw new Error(usersRes.error);
      if (campusesRes.error) throw new Error(campusesRes.error);
      if (userCampusesRes.error) throw new Error(userCampusesRes.error);
      setRoles(rolesRes.roles ?? []);
      setDraft(draftFromRoles(rolesRes.roles ?? []));
      setUsers(usersRes.users ?? []);
      setCampuses(campusesRes.campuses ?? []);
      setUserCampuses(userCampusesRes.user_campuses ?? {});
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveCampusScope(email: string, campusIds: number[]) {
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/user-campuses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, campus_ids: campusIds }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setUserCampuses((prev) => {
        const next = { ...prev };
        if (campusIds.length) next[email] = campusIds;
        else delete next[email];
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { load(); }, []);

  const editableRoles = roles.filter((r) => !r.is_admin);

  function setDraftCell(roleId: number, tabId: string, canView: boolean, canEdit: boolean) {
    setDraft((prev) => ({
      ...prev,
      [roleId]: { ...prev[roleId], [tabId]: { can_view: canView, can_edit: canEdit && canView } },
    }));
  }

  const dirty = editableRoles.some((r) =>
    TAB_IDS.some((tabId) => {
      const orig = r.permissions[tabId] ?? { can_view: false, can_edit: false };
      const d = draft[r.id]?.[tabId] ?? { can_view: false, can_edit: false };
      return orig.can_view !== d.can_view || orig.can_edit !== d.can_edit;
    }),
  );

  async function saveChanges() {
    setSaving(true);
    setErr(null);
    try {
      const changes: { role_id: number; tab_id: string; can_view: boolean; can_edit: boolean }[] = [];
      for (const r of editableRoles) {
        for (const tabId of TAB_IDS) {
          const orig = r.permissions[tabId] ?? { can_view: false, can_edit: false };
          const d = draft[r.id]?.[tabId] ?? { can_view: false, can_edit: false };
          if (orig.can_view !== d.can_view || orig.can_edit !== d.can_edit) {
            changes.push({ role_id: r.id, tab_id: tabId, can_view: d.can_view, can_edit: d.can_edit });
          }
        }
      }
      for (const c of changes) {
        const res = await apiFetch("/api/admin/roles", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    setDraft(draftFromRoles(roles));
  }

  async function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setNewRoleName("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteRole(id: number, name: string) {
    if (!confirm(`Delete role "${name}"? This only works if no user is currently assigned to it.`)) return;
    setErr(null);
    try {
      const res = await apiFetch(`/api/admin/roles?id=${id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function assignUser() {
    const email = newUserEmail.trim().toLowerCase();
    if (!email || !newUserRoleId) return;
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role_id: Number(newUserRoleId) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setNewUserEmail("");
      setNewUserRoleId("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeUser(email: string) {
    if (!confirm(`Remove access for ${email}?`)) return;
    setErr(null);
    try {
      const res = await apiFetch(`/api/admin/users?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-red-700 text-sm">{err}</p>}
      {loading && <p className="text-slate-500 text-sm">Loading…</p>}

      {!loading && (
        <>
          <div className="card">
            <h2 className="text-psu font-semibold mb-1">Roles &amp; Permissions</h2>
            <p className="text-xs text-slate-500 mb-3">
              View lets a role see the tab at all; Edit lets them make changes (upload, save, delete, etc.).
              The Admin role always has full access to everything and isn&apos;t shown here.
              Changes below aren&apos;t applied until you click <strong>Save changes</strong>.
            </p>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-1.5 pr-3 border-b border-slate-200">Tab</th>
                    {editableRoles.map((r) => (
                      <th key={r.id} className="p-1.5 text-center border-b border-slate-200 whitespace-nowrap">
                        {r.name}
                        <button className="ml-1 text-red-600 hover:underline" title="Delete role" onClick={() => deleteRole(r.id, r.name)}>×</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TAB_IDS.map((tabId) => (
                    <tr key={tabId}>
                      <td className="p-1.5 pr-3 border-b border-slate-100 whitespace-nowrap">{TAB_LABELS[tabId]}</td>
                      {editableRoles.map((r) => {
                        const p = draft[r.id]?.[tabId] ?? { can_view: false, can_edit: false };
                        return (
                          <td key={r.id} className="p-1.5 text-center border-b border-slate-100 whitespace-nowrap">
                            <label className="mr-2" title="Can view this tab">
                              <input type="checkbox" checked={p.can_view}
                                onChange={(e) => setDraftCell(r.id, tabId, e.target.checked, e.target.checked ? p.can_edit : false)} />
                              <span className="ml-0.5 text-slate-500">View</span>
                            </label>
                            <label title="Can make changes in this tab">
                              <input type="checkbox" checked={p.can_edit} disabled={!p.can_view}
                                onChange={(e) => setDraftCell(r.id, tabId, p.can_view, e.target.checked)} />
                              <span className="ml-0.5 text-slate-500">Edit</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button className="btn text-xs" disabled={!dirty || saving} onClick={saveChanges}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button className="btn-outline text-xs" disabled={!dirty || saving} onClick={discardChanges}>
                Discard changes
              </button>
              {dirty && !saving && <span className="text-xs text-amber-700">Unsaved changes</span>}
            </div>
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              <input className="input text-xs" placeholder="New role name" value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)} />
              <button className="btn-outline text-xs" onClick={addRole}>Add role</button>
            </div>
          </div>

          <div className="card">
            <h2 className="text-psu font-semibold mb-1">Users</h2>
            <p className="text-xs text-slate-500 mb-3">
              Accounts are still created in Supabase (Authentication → Users → Add user). This just grants
              an existing account a role once it can sign in.
            </p>
            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1 pr-2">Email</th>
                  <th className="py-1 pr-2">Role</th>
                  <th className="py-1 pr-2">Campus access</th>
                  <th className="py-1 pl-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{u.email}</td>
                    <td className="py-1.5 pr-2">{u.role_name}{u.is_admin && <span className="ml-1 text-[10px] bg-psu-gold/25 text-psu-gold-dark rounded px-1">admin</span>}</td>
                    <td className="py-1.5 pr-2">
                      {u.is_admin ? (
                        <span className="text-slate-400">All (admin)</span>
                      ) : (
                        <CampusAccessCell
                          campuses={campuses}
                          selected={userCampuses[u.email] ?? []}
                          onSave={(ids) => saveCampusScope(u.email, ids)}
                        />
                      )}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-red-600 text-xs hover:underline" onClick={() => removeUser(u.email)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-slate-400">No users assigned yet.</td></tr>
                )}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-2">
              <input type="email" className="input text-xs" placeholder="email@example.com" value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)} />
              <select className="input text-xs" value={newUserRoleId} onChange={(e) => setNewUserRoleId(e.target.value)}>
                <option value="">Select role</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button className="btn text-xs" disabled={!newUserEmail.trim() || !newUserRoleId} onClick={assignUser}>Assign</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Per-user campus restriction editor. No selection = unrestricted (sees
 *  every campus) -- that's today's default behavior, so nothing changes
 *  for a user until an admin explicitly picks one or more campuses here.
 *  Kept as its own local draft + explicit Save (not auto-save-per-click),
 *  same reasoning as the Roles &amp; Permissions matrix above. */
function CampusAccessCell({
  campuses, selected, onSave,
}: {
  campuses: Campus[];
  selected: number[];
  onSave: (ids: number[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<number[]>(selected);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraftIds(selected);
    setOpen(true);
  }

  function toggle(id: number) {
    setDraftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draftIds);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={selected.length ? "" : "text-slate-400"}>
          {selected.length
            ? campuses.filter((c) => selected.includes(c.id)).map((c) => c.name).join(", ")
            : "All campuses"}
        </span>
        <button className="text-psu underline shrink-0" onClick={startEdit}>Edit</button>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2 min-w-[220px]">
      <div className="max-h-32 overflow-y-auto space-y-0.5 mb-2">
        {campuses.map((c) => (
          <label key={c.id} className="flex items-center gap-1.5">
            <input type="checkbox" checked={draftIds.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{c.name}</span>
          </label>
        ))}
        {campuses.length === 0 && <p className="text-slate-400">No campuses yet.</p>}
      </div>
      <p className="text-slate-400 mb-2">No campuses checked = unrestricted (sees all).</p>
      <div className="flex gap-2">
        <button className="btn text-xs" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        <button className="btn-outline text-xs" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
