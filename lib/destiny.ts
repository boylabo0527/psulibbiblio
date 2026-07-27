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

// Confirmed against this instance's actual CircCatAdmin schema.
// CopyLibraryView carries per-copy details (barcode, call number, and
// Sublocation -- Destiny's own name for the field, already text, no join
// needed) and BibLibraryView carries the bibliographic (title-level) data.
// DateWithdrawn is null for copies still actually on the shelf; withdrawn
// copies are excluded so a withdrawn book doesn't keep re-appearing on
// every sync.
//
// Not filtered by BibType/CollectionType (Destiny's internal material-type
// codes) since this instance's exact enum values for "printed book" vs.
// other physical media aren't confirmed -- if this library also catalogs
// non-book physical items (AV, equipment, etc.) through the same tables,
// those would come through too. Add a `and bv.BibType = <n>` filter once
// you've confirmed the right value for "book" here (Destiny Admin console,
// or ask Follett support) if that turns out to matter.
//
// "sublocation" is finer-grained than this app's notion of "campus": some
// sublocations are each their own separate campus (the CCRD extension
// sites), while others are just sections of ONE campus's library (e.g.
// "Main - Reference" and "Main - Circulation" are both still Main Campus).
// See mapSublocationToCampus() below, which resolves that down to the
// campus name this app actually tracks.
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
  from CopyLibraryView cv
  join BibLibraryView bv on bv.BibID = cv.BibID
  where cv.DateWithdrawn is null
`;

// Destiny sublocation -> this app's campus name (see supabase/migrations/
// 05_campus_program_management.sql for the authoritative seeded list).
// Main and Manalo sublocations are sections within ONE campus each, so
// they all collapse to that campus's single name; CCRD sublocations are
// each already a distinct campus in their own right, so they map
// one-to-one (adjusting for a couple of naming differences, e.g. Destiny's
// "Española" vs. the seeded "PSU-SOFRONIO ESPANOLA").
//
const SUBLOCATION_TO_CAMPUS: Record<string, string> = {
  "CCRD - Araceli": "PSU-ARACELI",
  "CCRD - Balabac": "PSU-BALABAC",
  "CCRD - Bataraza": "PSU-BATARAZA",
  "CCRD - Brookes Point": "PSU-BROOKES POINT",
  "CCRD - Coron": "PSU-CORON",
  "CCRD - Dumaran": "PSU-DUMARAN",
  "CCRD - El Nido": "PSU-EL NIDO",
  "CCRD - Española": "PSU-SOFRONIO ESPANOLA",
  "CCRD - Linapacan": "PSU-LINAPACAN",
  "CCRD - Narra": "PSU-NARRA",
  "CCRD - PCAT Cuyo": "PSU-PCAT CUYO",
  "CCRD - Quezon": "PSU-QUEZON",
  "CCRD - Rizal": "PSU-RIZAL",
  "CCRD - Roxas": "PSU-ROXAS",
  // Note the space, not a hyphen, after "PSU" -- unlike the other CCRD
  // entries above, that's this campus's actual name in the campuses table.
  "CCRD - San Rafael": "PSU SAN RAFAEL",
  "CCRD - San Vicente": "PSU-SAN VICENTE",
  "CCRD - Taytay": "PSU-TAYTAY",

  "Main - American Corner": "Main Campus",
  "Main - Circulation": "Main Campus",
  "Main - Computer Room": "Main Campus",
  "Main - Filipiniana": "Main Campus",
  "Main - Medical Library": "Main Campus",
  "Main - Periodicals": "Main Campus",
  "Main - Reference": "Main Campus",
  "Main - Repository": "Main Campus",
  "Main - Reserve": "Main Campus",
  "Main - Special Collections": "Main Campus",
  "Main - Technical Section": "Main Campus",
  "Main - Theses and Dissertations": "Main Campus",

  "Manalo - Graduate School Library": "Manalo Campus",
  "Manalo - Law Library": "Manalo Campus",
  "Manalo - LES Library": "Manalo Campus",
};

/** Resolves a raw Destiny sublocation to this app's campus name. Falls
 *  back to the sublocation string itself when it's not in the table above
 *  (e.g. a new site/section added in Destiny since this list was written)
 *  -- the caller then flags it as an unrecognized campus rather than
 *  silently dropping or misfiling it. */
export function mapSublocationToCampus(sublocation: string): string {
  const trimmed = sublocation.trim();
  return SUBLOCATION_TO_CAMPUS[trimmed] ?? trimmed;
}

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

export type DestinyDiagnostics = {
  current_db: string;
  login_name: string;
  can_select_copylibraryview: boolean;
  can_select_biblibraryview: boolean;
};

/** Runs a handful of read-only metadata checks using the exact same
 *  connection/login the sync itself uses. Exists because SQL Server
 *  returns the same "Invalid object name" error for a table that
 *  genuinely doesn't exist AND for one that exists but the connecting
 *  login has no grant on (an anti-enumeration measure, not a bug) --
 *  from the sync's error message alone there's no way to tell those
 *  two cases apart. This pins it down without needing a separate SQL
 *  Server client. */
export async function diagnoseDestinyConnection(): Promise<DestinyDiagnostics> {
  const p = await getPool();
  const result = await p.request().query(`
    select
      DB_NAME()    as current_db,
      SUSER_SNAME() as login_name,
      has_perms_by_name('dbo.CopyLibraryView', 'OBJECT', 'SELECT') as can_select_copylibraryview,
      has_perms_by_name('dbo.BibLibraryView', 'OBJECT', 'SELECT')  as can_select_biblibraryview
  `);
  const row = result.recordset[0] as Record<string, unknown>;
  return {
    current_db: String(row.current_db ?? ""),
    login_name: String(row.login_name ?? ""),
    can_select_copylibraryview: !!row.can_select_copylibraryview,
    can_select_biblibraryview: !!row.can_select_biblibraryview,
  };
}

export type DestinyCatalogRow = {
  barcode?: string;
  call_no?: string;
  title: string;
  author?: string;
  publisher?: string;
  year?: string | number;
  sublocation?: string;
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
