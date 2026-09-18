#!/usr/bin/env node
/**
 * Pushes Destiny's printed-book catalog to this app from *inside* the
 * Destiny network, instead of the app reaching out to Destiny's SQL
 * Server directly (see app/api/sync/destiny/ingest/route.ts for why --
 * short version: Destiny's SQL Server firewall can't/shouldn't be opened
 * to Vercel's non-static outbound IPs).
 *
 * Run this on any machine that already has local network access to
 * Destiny's SQL Server -- the Destiny server itself, or any library
 * workstation on the same LAN. It only needs outbound HTTPS to reach
 * this app; Destiny's SQL Server never needs to accept a connection from
 * the internet.
 *
 * Requires Node.js 18+ (for the built-in `fetch`) and the `mssql`
 * package. Simplest way to get both: run this from inside a checkout of
 * this repo after `npm install`, e.g.:
 *
 *   node scripts/destiny-push.mjs
 *
 * Configure via environment variables -- the DESTINY_DB_* ones are the
 * exact same names and meaning as the app's own pull-based sync (see
 * lib/destiny.ts's header comment), since it's the same connection info,
 * just used locally here instead of from Vercel. Two more are new, for
 * talking to the app itself:
 *
 *   DESTINY_DB_HOST         -- hostname or IP of the SQL Server
 *   DESTINY_DB_NAME         -- database name
 *   DESTINY_DB_USER         -- a READ-ONLY login is strongly recommended
 *   DESTINY_DB_PASSWORD
 *   DESTINY_DB_PORT         -- optional, default 1433
 *   DESTINY_DB_ENCRYPT      -- optional, "true"/"false", default "true"
 *   DESTINY_DB_TRUST_CERT   -- optional, "true"/"false", default "false"
 *   DESTINY_CATALOG_QUERY   -- optional, overrides DEFAULT_QUERY below
 *
 *   PUSH_APP_URL            -- this app's URL, e.g. https://psulibbiblio.vercel.app
 *   DESTINY_INGEST_SECRET   -- must match the app's own env var of the
 *                              same name (Vercel project settings)
 *
 * Env vars can be set directly in whatever's launching this (a Windows
 * Task Scheduler action, a cron entry, etc.), or dropped in a
 * `destiny-push.env` file next to this script -- simple KEY=VALUE lines,
 * "#" comments allowed. This script loads that itself; no extra
 * dependency (like dotenv) needed. Never commit that file -- it holds a
 * database password and a secret token.
 *
 * Schedule this to run as often as you want the catalog refreshed --
 * nightly is plenty for most libraries. On Windows, Task Scheduler's
 * action would be:
 *   Program/script:  node
 *   Arguments:        scripts\destiny-push.mjs
 *   Start in:          <path to this repo checkout>
 * On Linux/macOS, a cron entry works the same way.
 */
import sql from "mssql";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv(join(__dirname, "destiny-push.env"));

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// Kept identical to lib/destiny.ts's DEFAULT_QUERY -- override with
// DESTINY_CATALOG_QUERY if your instance needs something different (same
// override the app's own pull-based sync supports).
const DEFAULT_QUERY = `
  select
    cv.CopyBarcode     as barcode,
    cv.CallNumber      as call_no,
    bv.Title           as title,
    bv.Author          as author,
    bv.Publisher       as publisher,
    bv.PublicationYear as year,
    cv.Sublocation     as sublocation,
    1                  as copies
  from CircCatAdmin.CopyLibraryView cv
  join CircCatAdmin.BibLibraryView bv on bv.BibID = cv.BibID
  where cv.DateWithdrawn is null
`;

const DB_HOST = required("DESTINY_DB_HOST");
const DB_PORT = parseInt(process.env.DESTINY_DB_PORT ?? "1433", 10);
const DB_NAME = required("DESTINY_DB_NAME");
const DB_USER = required("DESTINY_DB_USER");
const DB_PASSWORD = required("DESTINY_DB_PASSWORD");
const DB_ENCRYPT = (process.env.DESTINY_DB_ENCRYPT ?? "true") === "true";
const DB_TRUST_CERT = (process.env.DESTINY_DB_TRUST_CERT ?? "false") === "true";
const QUERY = process.env.DESTINY_CATALOG_QUERY?.trim() || DEFAULT_QUERY;

const APP_URL = required("PUSH_APP_URL").replace(/\/+$/, "");
const INGEST_SECRET = required("DESTINY_INGEST_SECRET");

async function fetchCatalog() {
  console.log(`Connecting to Destiny SQL Server at ${DB_HOST}:${DB_PORT} ...`);
  const pool = await new sql.ConnectionPool({
    server: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    options: { encrypt: DB_ENCRYPT, trustServerCertificate: DB_TRUST_CERT },
    connectionTimeout: 15000,
    requestTimeout: 120000,
  }).connect();
  try {
    const result = await pool.request().query(QUERY);
    return result.recordset;
  } finally {
    await pool.close();
  }
}

async function postJson(path, body) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${INGEST_SECRET}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path} responded ${res.status}`);
  return data;
}

async function main() {
  const rows = await fetchCatalog();
  console.log(`Fetched ${rows.length.toLocaleString()} row(s) from Destiny.`);

  console.log("Starting sync job...");
  const start = await postJson("/api/sync/destiny/ingest", { rows });
  if (!start.jobId) {
    console.log("Nothing to sync (0 usable rows).");
    return;
  }
  console.log(`Sync job ${start.jobId} queued: ${start.total.toLocaleString()} write(s).`);

  let done = false;
  while (!done) {
    const progress = await postJson("/api/sync/destiny/ingest/continue", { jobId: start.jobId });
    done = progress.done;
    const written = progress.inserted + progress.updated;
    console.log(`  ${written.toLocaleString()}/${progress.total.toLocaleString()} written` + (done ? " -- done." : "..."));
    if (!done) await new Promise((r) => setTimeout(r, 500));
  }
  console.log("Destiny sync complete.");
}

main().catch((err) => {
  console.error("Destiny push FAILED:", err?.message || err);
  process.exit(1);
});
