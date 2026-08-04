"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase-browser";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

/** Google accounts outside this Workspace domain shouldn't be able to sign
 *  in at all -- the "hd" param below only hints Google's account chooser
 *  to prefer this domain, it doesn't enforce anything, so the real check
 *  happens server-side too (see app/api/auth/provision-google) after the
 *  redirect back. */
const GOOGLE_HOSTED_DOMAIN = "psu.palawan.edu.ph";

const Ctx = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = browserClient();
    client.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
    const { data: sub } = client.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    loading,
    signIn: async (email, password) => {
      const client = browserClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signInWithGoogle: async () => {
      const client = browserClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { hd: GOOGLE_HOSTED_DOMAIN, prompt: "select_account" },
        },
      });
      return { error: error?.message ?? null };
    },
    signOut: async () => {
      const client = browserClient();
      await client.auth.signOut();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth called outside AuthProvider");
  return ctx;
}
