"use client";
import { useState } from "react";
import UploadTab from "@/components/UploadTab";
import MatchTab from "@/components/MatchTab";
import ProgramsTab from "@/components/ProgramsTab";
import DashboardTab from "@/components/DashboardTab";
import ProcurementTab from "@/components/ProcurementTab";
import CanvassingTab from "@/components/CanvassingTab";
import PurchaseRequestTab from "@/components/PurchaseRequestTab";
import LoginScreen from "@/components/LoginScreen";
import { useAuth } from "@/components/AuthProvider";

const tabs = [
  { id: "dashboard", label: "Dashboard",           publicTab: true  },
  { id: "upload",    label: "Upload",              publicTab: false },
  { id: "match",     label: "Match",               publicTab: false },
  { id: "programs",    label: "Programs & Export",   publicTab: false },
  { id: "procurement",      label: "Procurement Analysis", publicTab: false },
  { id: "canvassing",       label: "Market Canvassing",   publicTab: false },
  { id: "purchase-request", label: "Purchase Request",    publicTab: false },
] as const;
type TabId = (typeof tabs)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const { user, loading, signOut } = useAuth();

  const currentTab = tabs.find((t) => t.id === tab);
  const needsAuth = currentTab && !currentTab.publicTab && !user;

  return (
    <main>
      <header className="bg-psu text-white px-8 py-4 flex flex-wrap gap-4 justify-between items-center">
        <div>
          <h1 className="text-xl font-semibold">PSU Bibliography Generator</h1>
          <p className="text-xs opacity-90 mt-0.5">
            Per-program subject bibliographies · Dashboard is public · sign in to upload, match, and export.
          </p>
        </div>
        <div className="text-sm flex items-center gap-3">
          {loading ? (
            <span className="opacity-70 text-xs">…</span>
          ) : user ? (
            <>
              <span className="opacity-90 text-xs sm:text-sm">{user.email}</span>
              <button
                onClick={() => signOut()}
                className="border border-white/40 rounded px-3 py-1 text-xs hover:bg-white/10"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => setTab("upload")}
              className="border border-white/40 rounded px-3 py-1 text-xs hover:bg-white/10"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 px-8 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "py-3 px-4 text-sm border-b-2 transition whitespace-nowrap " +
              (tab === t.id
                ? "border-psu text-psu font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {t.label}
            {!t.publicTab && !user && (
              <span className="ml-1 text-xs" title="Sign in required">🔒</span>
            )}
          </button>
        ))}
      </nav>

      <section className="px-8 py-6 max-w-7xl mx-auto">
        {needsAuth ? (
          <LoginScreen />
        ) : tab === "dashboard" ? (
          <DashboardTab />
        ) : tab === "upload" ? (
          <UploadTab />
        ) : tab === "match" ? (
          <MatchTab />
        ) : tab === "programs" ? (
          <ProgramsTab />
        ) : tab === "procurement" ? (
          <ProcurementTab />
        ) : tab === "canvassing" ? (
          <CanvassingTab />
        ) : tab === "purchase-request" ? (
          <PurchaseRequestTab />
        ) : null}
      </section>

      <footer className="text-center text-xs text-slate-500 py-4">
        Hosted on Vercel · data in Supabase · local TF-IDF, no external AI keys.
      </footer>
    </main>
  );
}
