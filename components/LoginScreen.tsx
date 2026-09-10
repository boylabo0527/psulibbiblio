"use client";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "@/lib/api-client";

export default function LoginScreen() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Defaults to shown -- an admin explicitly disables it via User
  // Management, so a slow/failed settings fetch shouldn't hide it.
  const [googleLoginEnabled, setGoogleLoginEnabled] = useState(true);

  useEffect(() => {
    apiFetch("/api/settings").then((r) => r.json()).then((data) => {
      if (typeof data?.settings?.google_login_enabled === "boolean") {
        setGoogleLoginEnabled(data.settings.google_login_enabled);
      }
    }).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn(email, password);
    if (error) setErr(error);
    setBusy(false);
  }

  async function submitGoogle() {
    setGoogleBusy(true);
    setErr(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setErr(error);
      setGoogleBusy(false);
    }
    // On success the browser is redirected to Google, so nothing else to
    // do here -- this component unmounts.
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

      {googleLoginEnabled && (
        <>
          <div className="flex items-center gap-3 my-4">
            <div className="h-px bg-slate-200 flex-1" />
            <span className="text-xs text-slate-400">or</span>
            <div className="h-px bg-slate-200 flex-1" />
          </div>

          <button
            type="button" className="btn-outline w-full" disabled={googleBusy}
            onClick={submitGoogle}
          >
            {googleBusy ? "Redirecting…" : "Sign in with Google"}
          </button>
        </>
      )}

      <p className="text-xs text-slate-500 mt-4">
        Accounts are created by your library administrator in the Supabase dashboard
        (Authentication → Users → Add user). No public sign-up.
      </p>
    </div>
  );
}
