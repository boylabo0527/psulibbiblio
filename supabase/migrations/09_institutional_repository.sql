-- Migration: add "institutional_repository" as a new title format (open
-- access, digital -- theses, capstones, faculty research hosted in the
-- university's own repository). Cheap metadata-only change, safe to run as
-- one statement even on a large titles table.

alter table titles drop constraint if exists titles_format_check;

alter table titles add constraint titles_format_check check (format in (
  'ebook_paid', 'ebook_open',
  'book_printed',
  'journal_printed',
  'journal_online_paid', 'journal_online_open',
  'institutional_repository'
));
