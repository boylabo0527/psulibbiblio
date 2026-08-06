/** Thin wrapper over Resend's REST API (no SDK dependency -- one endpoint,
 *  a plain fetch is simpler than a whole package for it). Optional: if
 *  RESEND_API_KEY isn't set, every call just no-ops and reports why,
 *  matching how every other optional integration in this app behaves
 *  (Destiny sync, Hostinger overflow) -- the feature stays wired up and
 *  explains what's missing rather than failing loudly or being silently
 *  half-built. */
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "PSU Library Bibliography <onboarding@resend.dev>";
  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!opts.to) return { sent: false, reason: "no recipient email" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: `Resend API error ${res.status}: ${body}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
