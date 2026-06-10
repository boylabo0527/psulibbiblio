import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PSU Bibliography Generator",
  description: "Match Perlego titles to PSU courses and generate bibliographies and acquisition tables.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
