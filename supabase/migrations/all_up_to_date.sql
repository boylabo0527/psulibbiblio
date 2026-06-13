-- One-shot migration that brings any older database to current schema.
-- Safe to re-run; every statement is idempotent. Non-destructive: all
-- existing programs, subjects, titles, and assignments are kept.
--
-- Equivalent to running 02_resource_types.sql + 03_title_campus.sql +
-- 04_curriculum_only_programs.sql in order. If you've already run some
-- of those individually, running this on top is still safe.

-- ---------------------------------------------------------------------------
-- 02: expanded resource types + ISSN
-- ---------------------------------------------------------------------------
alter table titles drop constraint if exists titles_format_check;

alter table titles add column if not exists issn text default '';
create index if not exists titles_issn_idx on titles (issn);

update titles set format = 'ebook_paid'   where format = 'ebook';
update titles set format = 'book_printed' where format = 'printed';

alter table titles add constraint titles_format_check check (format in (
  'ebook_paid', 'ebook_open',
  'book_printed',
  'journal_printed',
  'journal_online_paid', 'journal_online_open'
));

-- ---------------------------------------------------------------------------
-- 03: campus column on printed titles
-- ---------------------------------------------------------------------------
alter table titles add column if not exists campus text default '';
create index if not exists titles_campus_idx on titles (campus);

-- ---------------------------------------------------------------------------
-- 04: programs are curriculum-only (no campus/college/section)
-- ---------------------------------------------------------------------------
drop index if exists programs_unique;
alter table programs drop column if exists campus;
alter table programs drop column if exists college;
alter table subjects drop column if exists section;
create unique index if not exists programs_unique on programs (name);
