"use client";
import { useState } from "react";
import { useAuth } from "./AuthProvider";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn(email, password);
    if (error) setErr(error);
    setBusy(false);
  }

  return (
    <div className="max-w-md mx-auto card mt-8">
      <h2 className="text-psu font-semibold mb-2 text-lg">Sign in</h2>
      <p className="text-sm text-slate-600 mb-4">
        The Dashboard tab is public. Uploads, matching, and reports require an account.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm text-slate-700 mb-1">Email</label>
          <input
            type="email" required autoComplete="email"
            className="input w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-slate-700 mb-1">Password</label>
          <input
            type="password" required autoComplete="current-password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {err && (
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </p>
        )}
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="text-xs text-slate-500 mt-4">
        Accounts are created by your library administrator in the Supabase dashboard
        (Authentication → Users → Add user). No public sign-up.
      </p>
    </div>
  );
}
