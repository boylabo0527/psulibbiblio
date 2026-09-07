-- Backfill: printed titles that predate the campus column (03_title_campus.sql)
-- were left with campus = '' when the column was added. Because '' was
-- treated as "matches every campus" by the app's filtering code, these
-- legacy Main Campus books were leaking into every other campus's list --
-- including campuses that never had a single title uploaded.
--
-- All ingest paths (manual upload, Destiny sync) always resolve a real
-- campus for campus-scoped rows going forward (see lib/ingest-titles.ts,
-- FALLBACK_CAMPUS = "Main Campus"), so any campus-scoped row still blank
-- today is one of these pre-existing rows and belongs to Main Campus.

update titles
set campus = 'Main Campus'
where format in ('book_printed', 'journal_printed')
  and (campus is null or trim(campus) = '');
