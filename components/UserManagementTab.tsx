"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

type Role = {
  id: number;
  name: string;
  is_admin: boolean;
  permissions: Record<string, { can_view: boolean; can_edit: boolean }>;
};
type UserAssignment = { email: string; role_id: number; role_name: string | null; is_admin: boolean; created_at: string };

const TAB_LABELS: Record<string, string> = {
  upload: "Upload",
  match: "Match",
  programs: "Programs & Export",
  "campus-validation": "Campus Validation",
  procurement: "Procurement Analysis",
  canvassing: "Market Canvassing",
  "purchase-request": "Purchase Request",
  activity: "Activity Log",
  "supplier-view": "Supplier View",
};
const TAB_IDS = Object.keys(TAB_LABELS);

export default function UserManagementTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRoleId, setNewUserRoleId] = useState<string>("");

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        apiFetch("/api/admin/roles").then((r) => r.json()),
        apiFetch("/api/admin/users").then((r) => r.json()),
      ]);
      if (rolesRes.error) throw new Error(rolesRes.error);
      if (usersRes.error) throw new Error(usersRes.error);
      setRoles(rolesRes.roles ?? []);
      setUsers(usersRes.users ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const editableRoles = roles.filter((r) => !r.is_admin);

  async function setPermission(roleId: number, tabId: string, canView: boolean, canEdit: boolean) {
    setErr(null);
    try {
      const res = await apiFetch("/api/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: roleId, tab_id: tabId, can_view: canView, can_edit: canEdit }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
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
                        const p = r.permissions[tabId] ?? { can_view: false, can_edit: false };
                        return (
                          <td key={r.id} className="p-1.5 text-center border-b border-slate-100 whitespace-nowrap">
                            <label className="mr-2" title="Can view this tab">
                              <input type="checkbox" checked={p.can_view}
                                onChange={(e) => setPermission(r.id, tabId, e.target.checked, e.target.checked ? p.can_edit : false)} />
                              <span className="ml-0.5 text-slate-500">View</span>
                            </label>
                            <label title="Can make changes in this tab">
                              <input type="checkbox" checked={p.can_edit} disabled={!p.can_view}
                                onChange={(e) => setPermission(r.id, tabId, p.can_view, e.target.checked)} />
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
                  <th className="py-1 pl-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">{u.email}</td>
                    <td className="py-1.5 pr-2">{u.role_name}{u.is_admin && <span className="ml-1 text-[10px] bg-psu-light text-psu rounded px-1">admin</span>}</td>
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-red-600 text-xs hover:underline" onClick={() => removeUser(u.email)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={3} className="py-2 text-slate-400">No users assigned yet.</td></tr>
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
