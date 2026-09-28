import "./globals.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "PSU Bibliography Generator",
  description: "Match Perlego titles to PSU courses and generate bibliographies and acquisition tables.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading headers() here (even unused) opts every route into dynamic
  // rendering, which is required for the CSP nonce from middleware.ts to
  // actually land on the page -- a statically prerendered page is built
  // once and can't embed a per-request value, so Next.js would otherwise
  // serve every visitor the same stale nonce baked in at build time (or
  // none at all), and the browser would refuse every script on the page.
  headers();

  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
