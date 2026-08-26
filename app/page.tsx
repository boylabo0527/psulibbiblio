"use client";
import { useEffect, useRef, useState } from "react";
import UploadTab from "@/components/UploadTab";
import MatchTab from "@/components/MatchTab";
import ProgramsTab from "@/components/ProgramsTab";
import DashboardTab from "@/components/DashboardTab";
import CleanupTab from "@/components/CleanupTab";
import ProcurementTab from "@/components/ProcurementTab";
import CanvassingTab from "@/components/CanvassingTab";
import PurchaseRequestTab from "@/components/PurchaseRequestTab";
import CampusValidationTab from "@/components/CampusValidationTab";
import ActivityLogTab from "@/components/ActivityLogTab";
import UserManagementTab from "@/components/UserManagementTab";
import SupplierViewTab from "@/components/SupplierViewTab";
import MonitoringTab from "@/components/MonitoringTab";
import FacultyRecommendationsTab from "@/components/FacultyRecommendationsTab";
import StandardTitlesTab from "@/components/StandardTitlesTab";
import SupplierDirectoryTab from "@/components/SupplierDirectoryTab";
import TorGeneratorTab from "@/components/TorGeneratorTab";
import CustomReportsTab from "@/components/CustomReportsTab";
import PublicSuggestTitleTab from "@/components/PublicSuggestTitleTab";
import LoginScreen from "@/components/LoginScreen";
import { useAuth } from "@/components/AuthProvider";
import { usePermissions, canView } from "@/lib/use-permissions";

const tabs = [
  { id: "dashboard", label: "Dashboard",           publicTab: true  },
  { id: "suggest-title", label: "Suggest a Title", publicTab: true  },
  { id: "upload",    label: "Upload",              publicTab: false },
  { id: "match",     label: "Match",               publicTab: false },
  { id: "programs",    label: "Programs & Export",   publicTab: false },
  { id: "campus-validation", label: "Campus Validation", publicTab: false },
  { id: "procurement",      label: "Procurement Analysis", publicTab: false },
  { id: "standard-titles",  label: "Standard Titles",      publicTab: false },
  { id: "canvassing",       label: "Market Canvassing",   publicTab: false },
  { id: "purchase-request", label: "Purchase Request",    publicTab: false },
  { id: "tor",              label: "Terms of Reference",  publicTab: false },
  { id: "faculty-recommendations", label: "Faculty Recommendations", publicTab: false },
  { id: "activity",         label: "Activity Log",        publicTab: false },
  { id: "supplier-view",    label: "Supplier View",       publicTab: false },
  { id: "supplier-directory", label: "Supplier Directory", publicTab: false },
  { id: "monitoring",       label: "Monitoring",          publicTab: false },
  { id: "reports",          label: "Custom Reports",      publicTab: false },
  { id: "cleanup",          label: "Cleanup",             publicTab: false },
  { id: "user-management",  label: "User Management",     publicTab: false },
] as const;
type TabId = (typeof tabs)[number]["id"];

// Groups the tab bar into dropdown menus so the nav doesn't sprawl as more
// tabs get added -- "dashboard" is rendered standalone, outside any group.
// A tab can appear in more than one group if it genuinely belongs to both
// (e.g. Market Canvassing is both an acquisitions step and a
// supplier-facing one); each group only shows if at least one of its tabs
// is visible to the signed-in user.
const NAV_GROUPS: { id: string; label: string; tabIds: TabId[] }[] = [
  { id: "catalog", label: "Catalog", tabIds: ["upload", "match", "campus-validation"] },
  { id: "acquisitions", label: "Acquisitions", tabIds: ["programs", "procurement", "standard-titles", "canvassing", "purchase-request", "faculty-recommendations"] },
  { id: "suppliers", label: "Suppliers", tabIds: ["canvassing", "supplier-view", "supplier-directory", "faculty-recommendations"] },
  { id: "oversight", label: "Oversight", tabIds: ["activity", "monitoring", "tor"] },
  { id: "admin", label: "Admin", tabIds: ["reports", "cleanup", "user-management"] },
];

export default function Home() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const { user, loading, signOut } = useAuth();
  const { perms, loading: permsLoading } = usePermissions();

  useEffect(() => {
    if (!openGroup) return;
    function onClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [openGroup]);

  const currentTab = tabs.find((t) => t.id === tab);
  const needsAuth = currentTab && !currentTab.publicTab && !user;

  // A tab is visible if it's public, or the signed-in user's role can view
  // it -- "user-management" and "cleanup" are special-cased to admins
  // only: user-management configures role permissions themselves, and
  // cleanup (merging duplicate programs/titles catalog-wide) is a power
  // tool that predates the per-tab permission system. The Perlego archive
  // search lives inside Programs & Export and gates itself on isAdmin
  // directly (it reads from org-wide Hostinger credentials, not anything
  // scoped per-tab).
  const visibleTabs = tabs.filter((t) => {
    if (t.publicTab) return true;
    if (!user) return false;
    if (t.id === "user-management" || t.id === "cleanup") return perms.isAdmin;
    return canView(perms, t.id);
  });

  return (
    <main>
      <header className="bg-psu text-white px-4 sm:px-8 py-4 flex flex-wrap gap-4 justify-between items-center border-b-4 border-psu-gold">
        <div className="flex items-center gap-3 min-w-0">
          <button
            className="sm:hidden shrink-0 border border-white/40 rounded p-2 leading-none"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold truncate">PSU Bibliography Generator</h1>
            <p className="text-xs opacity-90 mt-0.5 hidden sm:block">
              Per-program subject bibliographies · Dashboard is public · sign in to upload, match, and export.
            </p>
          </div>
        </div>
        <div className="text-sm flex items-center gap-3">
          {loading ? (
            <span className="opacity-70 text-xs">…</span>
          ) : user ? (
            <>
              <span className="opacity-90 text-xs sm:text-sm hidden sm:inline">
                {user.email}{perms.role && <span className="opacity-70"> · {perms.role}</span>}
              </span>
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

      {/* Desktop nav: horizontal bar of dropdown groups -- hidden below sm,
          where it has no room and would force the whole page to scroll
          sideways (px-8 padding alone eats most of a 375px viewport). */}
      <nav ref={navRef} className="hidden sm:flex bg-white border-b border-slate-200 px-8 gap-1 overflow-visible relative">
        {visibleTabs.filter((t) => t.publicTab).map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setOpenGroup(null); }}
            className={
              "py-3 px-4 text-sm border-b-2 transition whitespace-nowrap " +
              (tab === t.id
                ? "border-psu text-psu font-semibold"
                : "border-transparent text-slate-500 hover:text-slate-800")
            }
          >
            {t.label}
          </button>
        ))}
        {NAV_GROUPS.map((g) => {
          const items = visibleTabs.filter((t) => (g.tabIds as readonly string[]).includes(t.id));
          if (items.length === 0) return null;
          const isActiveGroup = items.some((t) => t.id === tab);
          const isOpen = openGroup === g.id;
          return (
            <div key={g.id} className="relative">
              <button
                onClick={() => setOpenGroup(isOpen ? null : g.id)}
                className={
                  "py-3 px-4 text-sm border-b-2 transition whitespace-nowrap flex items-center gap-1 " +
                  (isActiveGroup
                    ? "border-psu text-psu font-semibold"
                    : "border-transparent text-slate-500 hover:text-slate-800")
                }
              >
                {g.label}
                <span className="text-[9px] mt-0.5">▾</span>
              </button>
              {isOpen && (
                <div className="absolute left-0 top-full z-20 bg-white border border-slate-200 rounded shadow-lg py-1 min-w-[210px]">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setTab(t.id); setOpenGroup(null); }}
                      className={
                        "w-full text-left px-3 py-2 text-sm whitespace-nowrap " +
                        (tab === t.id ? "text-psu font-semibold bg-psu-light/40" : "text-slate-600 hover:bg-slate-50")
                      }
                    >
                      {t.label}
                      {!t.publicTab && !user && (
                        <span className="ml-1 text-xs" title="Sign in required">🔒</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Mobile nav: full-width stacked menu triggered by the hamburger
          button above, grouped the same way as the desktop dropdowns so
          the two stay in sync without a separate tab list to maintain. */}
      {mobileMenuOpen && (
        <nav className="sm:hidden bg-white border-b border-slate-200 max-h-[70vh] overflow-y-auto">
          {visibleTabs.filter((t) => t.publicTab).map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setMobileMenuOpen(false); }}
              className={
                "block w-full text-left px-4 py-3 text-sm border-b border-slate-100 " +
                (tab === t.id ? "text-psu font-semibold bg-psu-light/40" : "text-slate-700")
              }
            >
              {t.label}
            </button>
          ))}
          {NAV_GROUPS.map((g) => {
            const items = visibleTabs.filter((t) => (g.tabIds as readonly string[]).includes(t.id));
            if (items.length === 0) return null;
            return (
              <div key={g.id} className="border-b border-slate-100">
                <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
                {items.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setMobileMenuOpen(false); }}
                    className={
                      "block w-full text-left px-4 py-2.5 text-sm " +
                      (tab === t.id ? "text-psu font-semibold bg-psu-light/40" : "text-slate-600")
                    }
                  >
                    {t.label}
                    {!t.publicTab && !user && (
                      <span className="ml-1 text-xs" title="Sign in required">🔒</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      )}

      <section className="px-4 sm:px-8 py-6 max-w-7xl mx-auto">
        {needsAuth ? (
          <LoginScreen />
        ) : user && !permsLoading && currentTab && !currentTab.publicTab && !visibleTabs.some((t) => t.id === tab) ? (
          <p className="text-slate-500 text-sm">
            Your account doesn&apos;t have access to this tab. Contact your administrator if you think this is wrong.
          </p>
        ) : tab === "dashboard" ? (
          <DashboardTab />
        ) : tab === "suggest-title" ? (
          <PublicSuggestTitleTab />
        ) : tab === "upload" ? (
          <UploadTab />
        ) : tab === "match" ? (
          <MatchTab />
        ) : tab === "programs" ? (
          <ProgramsTab />
        ) : tab === "campus-validation" ? (
          <CampusValidationTab />
        ) : tab === "procurement" ? (
          <ProcurementTab />
        ) : tab === "standard-titles" ? (
          <StandardTitlesTab />
        ) : tab === "canvassing" ? (
          <CanvassingTab />
        ) : tab === "purchase-request" ? (
          <PurchaseRequestTab />
        ) : tab === "faculty-recommendations" ? (
          <FacultyRecommendationsTab />
        ) : tab === "activity" ? (
          <ActivityLogTab />
        ) : tab === "supplier-view" ? (
          <SupplierViewTab />
        ) : tab === "supplier-directory" ? (
          <SupplierDirectoryTab />
        ) : tab === "monitoring" ? (
          <MonitoringTab />
        ) : tab === "tor" ? (
          <TorGeneratorTab />
        ) : tab === "reports" ? (
          <CustomReportsTab />
        ) : tab === "user-management" ? (
          <UserManagementTab />
        ) : tab === "cleanup" ? (
          <CleanupTab />
        ) : null}
      </section>

      <footer className="text-center text-xs text-slate-500 py-4">
        Hosted on Vercel · data in Supabase · local TF-IDF, no external AI keys.
      </footer>
    </main>
  );
}
