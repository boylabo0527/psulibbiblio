-- Migration: expand resource types and add ISSN for journals.
--
-- Run this in the Supabase SQL Editor on an existing database that was
-- created from an earlier schema.sql. Non-destructive: keeps all existing
-- titles, subjects, programs, and assignments.
--
-- For a fresh database, just run schema.sql instead.

-- 1. Add ISSN column for journals (no-op if it already exists).
alter table titles add column if not exists issn text default '';
create index if not exists titles_issn_idx on titles (issn);

-- 2. Backfill old format values to the new naming.
update titles set format = 'ebook_paid'   where format = 'ebook';
update titles set format = 'book_printed' where format = 'printed';

-- 3. Replace the check constraint to allow all six resource types.
alter table titles drop constraint if exists titles_format_check;
alter table titles add constraint titles_format_check check (format in (
  'ebook_paid', 'ebook_open',
  'book_printed',
  'journal_printed',
  'journal_online_paid', 'journal_online_open'
));
