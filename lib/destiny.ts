/**
 * Connects to a Follett Destiny installation's underlying MS SQL Server to
 * pull the printed-book catalog directly, instead of a manual
 * export-then-upload cycle.
 *
 * Destiny's actual schema (table/column names) is proprietary, varies by
 * version, and isn't something this code can know in advance -- rather
 * than hardcode a guess that might silently be wrong, the query itself is
 * fully configurable via DESTINY_CATALOG_QUERY (see below). Set the
 * connection env vars in Vercel's project settings, never commit them.
 *
 * Required env vars:
 *   DESTINY_DB_HOST      -- hostname or IP of the SQL Server
 *   DESTINY_DB_NAME      -- database name
 *   DESTINY_DB_USER      -- a READ-ONLY login is strongly recommended;
 *                           this connection only ever runs SELECT queries,
 *                           but a read-only grant is a safety net against
 *                           a future code change (or a bug) accidentally
 *                           writing back into your live circulation system.
 *   DESTINY_DB_PASSWORD
 * Optional:
 *   DESTINY_DB_PORT          -- default 1433
 *   DESTINY_DB_ENCRYPT       -- "true"/"false", default "true"
 *   DESTINY_DB_TRUST_CERT    -- "true"/"false", default "false" -- set
 *                               "true" only if Destiny's SQL Server uses a
 *                               self-signed certificate you can't otherwise
 *                               validate.
 *   DESTINY_CATALOG_QUERY    -- the actual SQL to run (see DEFAULT_QUERY
 *                               below for the required output columns).
 *                               Override this with whatever query already
 *                               works against your instance -- e.g. reused
 *                               from another project that already syncs
 *                               from the same Destiny database.
 */
import sql from "mssql";

// Best-effort placeholder, NOT confirmed against a real Destiny schema --
// replace via DESTINY_CATALOG_QUERY once you've verified the real table
// and column names (Destiny Administrator's "Advanced Reports" / a DBA can
// confirm these, or reuse a query from anywhere else you already query
// this same database). Whatever query you use MUST return columns named
// exactly: barcode, call_no, title, author, publisher, year, campus,
// copies -- alias them in the SELECT if your real column names differ.
const DEFAULT_QUERY = `
  select
    cp.Barcode          as barcode,
    ti.CallNumber        as call_no,
    ti.Title             as title,
    ti.Author            as author,
    ti.Publisher         as publisher,
    ti.PublicationYear   as year,
    si.Name              as campus,
    1                    as copies
  from Copy cp
  join Title ti on ti.TitleID = cp.TitleID
  left join Site si on si.SiteID = cp.SiteID
  where cp.LostOrMissing = 0
`;

export function destinyEnabled(): boolean {
  return !!(
    process.env.DESTINY_DB_HOST &&
    process.env.DESTINY_DB_NAME &&
    process.env.DESTINY_DB_USER &&
    process.env.DESTINY_DB_PASSWORD
  );
}

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool({
    server: process.env.DESTINY_DB_HOST!,
    port: parseInt(process.env.DESTINY_DB_PORT ?? "1433", 10),
    database: process.env.DESTINY_DB_NAME!,
    user: process.env.DESTINY_DB_USER!,
    password: process.env.DESTINY_DB_PASSWORD!,
    options: {
      encrypt: (process.env.DESTINY_DB_ENCRYPT ?? "true") === "true",
      trustServerCertificate: (process.env.DESTINY_DB_TRUST_CERT ?? "false") === "true",
    },
    connectionTimeout: 15000,
    requestTimeout: 120000,
  }).connect();
  return pool;
}

export type DestinyCatalogRow = {
  barcode?: string;
  call_no?: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: string | number;
  campus?: string;
  copies?: number;
};

export async function fetchDestinyPrintedCatalog(): Promise<DestinyCatalogRow[]> {
  const p = await getPool();
  const query = process.env.DESTINY_CATALOG_QUERY?.trim() || DEFAULT_QUERY;
  const result = await p.request().query(query);
  const rows = result.recordset as Record<string, unknown>[];
  for (const r of rows) {
    if (!("title" in r)) {
      throw new Error(
        "The Destiny query's result is missing a 'title' column. Check DESTINY_CATALOG_QUERY -- " +
        "it must alias its columns as: barcode, call_no, title, author, publisher, year, campus, copies.",
      );
    }
  }
  return rows as unknown as DestinyCatalogRow[];
}
