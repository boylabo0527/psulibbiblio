-- Migration: expand resource types and add ISSN for journals.
--
-- Run this in the Supabase SQL Editor on an existing database that was
-- created from an earlier schema.sql. Non-destructive: keeps all existing
-- titles, subjects, programs, and assignments.
--
-- For a fresh database, just run schema.sql instead.

-- 1. Drop the old check constraint FIRST so we can rename values without
-- violating it. (If we updated first, Postgres rejects 'ebook_paid' on
-- the old constraint that only allows 'ebook' | 'printed'.)
alter table titles drop constraint if exists titles_format_check;

-- 2. Add ISSN column for journals (no-op if it already exists).
alter table titles add column if not exists issn text default '';
create index if not exists titles_issn_idx on titles (issn);

-- 3. Backfill old format values to the new naming. No-op rows if these
-- have already been renamed by a previous migration attempt.
update titles set format = 'ebook_paid'   where format = 'ebook';
update titles set format = 'book_printed' where format = 'printed';

-- 4. Re-add the check constraint with all six resource types.
alter table titles add constraint titles_format_check check (format in (
  'ebook_paid', 'ebook_open',
  'book_printed',
  'journal_printed',
  'journal_online_paid', 'journal_online_open'
));
