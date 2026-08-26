import type { Metadata } from "next";
import PublicSuggestTitleTab from "@/components/PublicSuggestTitleTab";

export const metadata: Metadata = {
  title: "Suggest a Title — PSU Bibliography Generator",
  description: "Recommend a book for your course. No sign-in needed.",
};

/** A standalone, shareable URL for the public Suggest a Title form -- the
 *  same form lives inside the main app as the "suggest-title" tab, but
 *  getting there means opening the nav first. This route drops straight
 *  into the form so a link (poster QR code, group chat, etc.) needs zero
 *  clicks once opened. */
export default function SuggestTitlePage() {
  return (
    <main>
      <header className="bg-psu text-white px-4 sm:px-8 py-4 flex flex-wrap gap-3 justify-between items-center border-b-4 border-psu-gold">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold">PSU Bibliography Generator</h1>
          <p className="text-xs opacity-90 mt-0.5">Suggest a Title · no sign-in needed</p>
        </div>
        <a href="/" className="border border-white/40 rounded px-3 py-1 text-xs hover:bg-white/10">
          Go to full site
        </a>
      </header>
      <section className="px-4 sm:px-8 py-6 max-w-7xl mx-auto">
        <PublicSuggestTitleTab />
      </section>
      <footer className="text-center text-xs text-slate-500 py-4">
        Hosted on Vercel · data in Supabase
      </footer>
    </main>
  );
}
