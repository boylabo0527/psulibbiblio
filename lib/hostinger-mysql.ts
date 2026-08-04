/**
 * Connects to a MySQL database on the library's existing Hostinger shared
 * hosting, used as an overflow store for the eBook catalog titles that
 * don't fit Supabase's free-tier storage cap -- titles never matched to
 * any subject (so not needed for day-to-day use) are moved here instead
 * of deleted outright, and stay searchable from the "Perlego Catalog" tab.
 *
 * Required env vars:
 *   HOSTINGER_DB_HOST
 *   HOSTINGER_DB_NAME
 *   HOSTINGER_DB_USER
 *   HOSTINGER_DB_PASSWORD
 * Optional:
 *   HOSTINGER_DB_PORT  -- default 3306
 *   HOSTINGER_DB_SSL   -- "true"/"false", default "false" -- most shared
 *                         MySQL hosting doesn't offer TLS on remote
 *                         connections, unlike Supabase's Postgres.
 *
 * Also requires Hostinger's hPanel "Remote MySQL" access to be opened for
 * Vercel to reach it at all -- shared hosting normally only allows
 * connections from its own server. See the CREATE TABLE statement below
 * for the schema this expects (run once via phpMyAdmin).
 */
import mysql from "mysql2/promise";

export function hostingerEnabled(): boolean {
  return !!(
    process.env.HOSTINGER_DB_HOST &&
    process.env.HOSTINGER_DB_NAME &&
    process.env.HOSTINGER_DB_USER &&
    process.env.HOSTINGER_DB_PASSWORD
  );
}

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.HOSTINGER_DB_HOST!,
    port: parseInt(process.env.HOSTINGER_DB_PORT ?? "3306", 10),
    database: process.env.HOSTINGER_DB_NAME!,
    user: process.env.HOSTINGER_DB_USER!,
    password: process.env.HOSTINGER_DB_PASSWORD!,
    ssl: (process.env.HOSTINGER_DB_SSL ?? "false") === "true" ? {} : undefined,
    connectionLimit: 5,
    connectTimeout: 15000,
  });
  return pool;
}

/*
Run once in phpMyAdmin (or any MySQL client) against the Hostinger
database before using this feature:

create table if not exists perlego_titles (
  id          bigint auto_increment primary key,
  source_id   bigint not null unique,
  title       varchar(1000) not null,
  author      varchar(500) default '',
  publisher   varchar(500) default '',
  year        varchar(20) default '',
  isbn        varchar(50) default '',
  url         varchar(1000) default '',
  subjects    text,
  provider    varchar(200) default '',
  moved_at    timestamp default current_timestamp,
  index idx_title (title(191)),
  index idx_author (author(191)),
  index idx_isbn (isbn)
);
*/

export type PerlegoTitle = {
  source_id: number;
  title: string;
  author?: string;
  publisher?: string;
  year?: string;
  isbn?: string;
  url?: string;
  subjects?: string;
  provider?: string;
};

/** Inserts a batch of titles, skipping (not erroring on) any source_id
 *  already present -- makes re-running a batch after a partial failure
 *  safe instead of risking duplicates. */
export async function insertPerlegoTitles(rows: PerlegoTitle[]): Promise<void> {
  if (!rows.length) return;
  const p = getPool();
  const values = rows.map((r) => [
    r.source_id, r.title, r.author ?? "", r.publisher ?? "", r.year ?? "",
    r.isbn ?? "", r.url ?? "", r.subjects ?? "", r.provider ?? "",
  ]);
  await p.query(
    `insert ignore into perlego_titles
     (source_id, title, author, publisher, year, isbn, url, subjects, provider)
     values ?`,
    [values],
  );
}

export type PerlegoSearchResult = {
  rows: (PerlegoTitle & { id: number })[];
  total: number;
};

/** Searches the moved-out catalog by title/author/isbn, paginated. Empty
 *  query returns everything (paginated), newest-moved first. */
export async function searchPerlegoTitles(
  query: string, page: number, pageSize: number,
): Promise<PerlegoSearchResult> {
  const p = getPool();
  const offset = Math.max(0, (page - 1) * pageSize);
  const like = `%${query.trim()}%`;
  const where = query.trim() ? "where title like ? or author like ? or isbn like ?" : "";
  const whereParams = query.trim() ? [like, like, like] : [];

  const [countRows] = await p.query(
    `select count(*) as total from perlego_titles ${where}`,
    whereParams,
  );
  const total = (countRows as { total: number }[])[0]?.total ?? 0;

  const [rows] = await p.query(
    `select id, source_id, title, author, publisher, year, isbn, url, subjects, provider
     from perlego_titles ${where}
     order by id desc
     limit ? offset ?`,
    [...whereParams, pageSize, offset],
  );
  return { rows: rows as (PerlegoTitle & { id: number })[], total };
}

/** Total row count -- used to show "N titles archived" without a search. */
export async function countPerlegoTitles(): Promise<number> {
  const p = getPool();
  const [rows] = await p.query("select count(*) as total from perlego_titles");
  return (rows as { total: number }[])[0]?.total ?? 0;
}
