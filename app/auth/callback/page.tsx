"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase-browser";
import { apiFetch } from "@/lib/api-client";

/** Landing page for the Google OAuth redirect (see AuthProvider's
 *  signInWithGoogle). By the time this mounts, the Supabase client has
 *  already exchanged the ?code in the URL for a session (detectSessionInUrl
 *  is on, see lib/supabase-browser.ts) -- getSession() below just waits for
 *  that to finish. This then calls /api/auth/provision-google, which
 *  enforces the @psu.palawan.edu.ph domain restriction server-side (the
 *  "hd" hint on the Google request can't be trusted on its own) and grants
 *  the default Faculty Member role on a first-time sign-in. A domain
 *  mismatch or any other failure here signs the user back out immediately
 *  -- Google auth succeeding isn't enough on its own to use this app. */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      setErr(oauthError);
      return;
    }

    (async () => {
      const client = browserClient();
      const { data, error } = await client.auth.getSession();
      if (error || !data.session) {
        setErr(error?.message ?? "Sign-in didn't complete. Please try again.");
        return;
      }
      try {
        const res = await apiFetch("/api/auth/provision-google", { method: "POST" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) {
          await client.auth.signOut();
          setErr(j.error || `HTTP ${res.status}`);
          return;
        }
      } catch (e) {
        await client.auth.signOut();
        setErr(e instanceof Error ? e.message : String(e));
        return;
      }
      router.replace("/");
    })();
  }, [router]);

  return (
    <div className="max-w-md mx-auto card mt-8 text-center">
      {err ? (
        <>
          <p className="text-red-700 text-sm bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{err}</p>
          <a href="/" className="btn-outline text-sm inline-block">Back to sign in</a>
        </>
      ) : (
        <p className="text-slate-500 text-sm">Signing you in…</p>
      )}
    </div>
  );
}
