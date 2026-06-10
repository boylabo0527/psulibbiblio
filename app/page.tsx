"use client";
import { useState } from "react";
import UploadTab from "@/components/UploadTab";
import MatchTab from "@/components/MatchTab";
import ProgramsTab from "@/components/ProgramsTab";
import DashboardTab from "@/components/DashboardTab";

const tabs = [
  { id: "upload", label: "1. Upload" },
  { id: "match", label: "2. Match" },
  { id: "programs", label: "3. Programs & Export" },
  { id: "dashboard", label: "4. Dashboard" },
] as const;
type TabId = (typeof tabs)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<TabId>("upload");
  return (
    <main>
      <header className="bg-psu text-white px-8 py-6">
        <h1 className="text-xl font-semibold">PSU Bibliography Generator</h1>
        <p className="text-sm opacity-90">
          Per-program subject bibliographies with eBooks (Kavita) and Printed Books, summary totals, and exportable XLSX/PDF/DOCX.
        </p>
      </header>

      <nav className="bg-white border-b border-slate-200 px-8 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "py-3 px-4 text-sm border-b-2 transition " +
              (tab === t.id ? "border-psu text-psu font-semibold" : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <section className="px-8 py-6 max-w-7xl mx-auto">
        {tab === "upload" && <UploadTab />}
        {tab === "match" && <MatchTab />}
        {tab === "programs" && <ProgramsTab />}
        {tab === "dashboard" && <DashboardTab />}
      </section>

      <footer className="text-center text-xs text-slate-500 py-4">
        Hosted on Vercel · data in Supabase · local TF-IDF, no external AI keys.
      </footer>
    </main>
  );
}
