import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { logActivity, userEmailFromRequest } from "@/lib/activity";
import { getUserPermissions } from "@/lib/permissions";
import { hostingerEnabled, insertPerlegoTitles } from "@/lib/hostinger-mysql";
import { errorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Small enough that a batch (Hostinger insert + Supabase delete) comfortably
// finishes well under Vercel's real enforced function timeout -- see the
// Destiny sync's BUDGET_MS for the same reasoning; this endpoint is called
// in a loop from the browser rather than trying to do everything in one call.
const BATCH_SIZE = 2000;

/** POST /api/admin/migrate-to-hostinger { format, dryRun }
 *
 *  Moves titles of the given format that have never been assigned to any
 *  subject out of Supabase and into the library's Hostinger MySQL
 *  database (see lib/hostinger-mysql.ts), then deletes them from Supabase
 *  -- freeing storage without losing the data, since it stays searchable
 *  from the Perlego Catalog tab.
 *
 *  Order matters for safety: a batch is inserted into MySQL BEFORE being
 *  deleted from Supabase, and the MySQL insert is idempotent (INSERT
 *  IGNORE keyed on source_id) -- so if the Supabase delete fails after a
 *  successful insert, retrying the same batch just skips the rows already
 *  there instead of duplicating them, and nothing is ever lost from
 *  either side.
 *
 *  dryRun previews the total count without moving anything. Admin-only,
 *  since it uses org-wide database credentials and permanently removes
 *  rows from Supabase. */
export async function POST(req: Request) {
  const userEmail = userEmailFromRequest(req);
  const db = serviceClient();
  const perms = await getUserPermissions(db, userEmail);
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "Only an admin can run this." }, { status: 403 });
  }
  if (!hostingerEnabled()) {
    return NextResponse.json({
      error: "Hostinger migration isn't configured yet -- set HOSTINGER_DB_HOST, HOSTINGER_DB_NAME, HOSTINGER_DB_USER, and HOSTINGER_DB_PASSWORD in Vercel's project settings.",
    }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as { format?: string; dryRun?: boolean };
  const format = body.format || "ebook_paid";

  try {
    if (body.dryRun) {
      const { data, error } = await db.rpc("unmatched_titles_count", { p_format: format });
      if (error) throw error;
      return NextResponse.json({ remaining: Number(data ?? 0) });
    }

    const { data: batch, error: batchErr } = await db.rpc("unmatched_titles_batch", {
      p_format: format, batch_size: BATCH_SIZE,
    });
    if (batchErr) throw batchErr;
    const rows = (batch ?? []) as {
      id: number; title: string; author: string; publisher: string; year: string;
      isbn: string; url: string; subjects: string; provider: string;
    }[];

    if (rows.length === 0) {
      return NextResponse.json({ done: true, migrated: 0, remaining: 0 });
    }

    await insertPerlegoTitles(rows.map((r) => ({
      source_id: r.id, title: r.title, author: r.author, publisher: r.publisher,
      year: r.year, isbn: r.isbn, url: r.url, subjects: r.subjects, provider: r.provider,
    })));

    const ids = rows.map((r) => r.id);
    const { error: delErr } = await db.from("titles").delete().in("id", ids);
    if (delErr) throw delErr;

    const { data: countData, error: countErr } = await db.rpc("unmatched_titles_count", { p_format: format });
    if (countErr) throw countErr;
    const remaining = Number(countData ?? 0);
    const done = remaining === 0;

    if (done) {
      await logActivity(db, {
        userEmail, action: "hostinger_migrate",
        summary: `Migrated unmatched ${format} titles to Hostinger MySQL (overflow storage), freeing Supabase space`,
        detail: { format },
      });
    }

    return NextResponse.json({ done, migrated: rows.length, remaining });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
