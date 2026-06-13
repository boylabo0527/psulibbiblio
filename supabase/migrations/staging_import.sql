-- Direct CSV → titles via staging tables.
--
-- Use this when you want to skip the web upload (e.g. the file is too big
-- for the Vercel Hobby 60s cap, or the function keeps stalling). Each
-- block is one resource type. Workflow:
--
-- 1. Run the CREATE TABLE for the type you're importing.
-- 2. In Supabase Dashboard → Table Editor → pick the staging table →
--    "Insert" → "Import data from CSV" → upload your file. Map columns
--    by name (the staging columns match the most common headers).
-- 3. Run the INSERT … SELECT block to copy from staging into `titles`
--    with deduplication. Run it as many times as you need — it's safe.
-- 4. (Optional) Drop or truncate the staging table when done.
--
-- After each insert, the matcher (/api/match/run on the deployed app)
-- will pick up the new rows.

-- =========================================================================
-- 1. Paid / Subscribed eBooks (Perlego, Kavita)
--    Matches the columns publication_title / online_identifier /
--    title_url / first_author / publisher_name / year that Perlego exports.
-- =========================================================================
create table if not exists ebook_paid_staging (
  publication_title text,
  online_identifier text,
  title_url         text,
  first_author      text,
  publisher_name    text,
  year              text
);
-- truncate ebook_paid_staging;  -- uncomment to clear between imports

-- After importing CSV via Table Editor, run:
insert into titles (format, title, author, publisher, year, isbn, url, copies)
select
  'ebook_paid',
  publication_title,
  coalesce(first_author, ''),
  coalesce(publisher_name, ''),
  coalesce(year, ''),
  coalesce(online_identifier, ''),
  coalesce(title_url, ''),
  1
from ebook_paid_staging s
where publication_title is not null
  and not exists (
    select 1 from titles t
    where t.format = 'ebook_paid'
      and ((s.online_identifier is not null
            and s.online_identifier <> ''
            and t.isbn = s.online_identifier)
        or (coalesce(s.online_identifier, '') = ''
            and t.title = s.publication_title
            and t.author = coalesce(s.first_author, '')
            and t.year   = coalesce(s.year, '')))
  );

-- =========================================================================
-- 2. Open Source eBooks (same columns as Perlego)
-- =========================================================================
create table if not exists ebook_open_staging (
  publication_title text,
  online_identifier text,
  title_url         text,
  first_author      text,
  publisher_name    text,
  year              text
);

insert into titles (format, title, author, publisher, year, isbn, url, copies)
select
  'ebook_open',
  publication_title,
  coalesce(first_author, ''),
  coalesce(publisher_name, ''),
  coalesce(year, ''),
  coalesce(online_identifier, ''),
  coalesce(title_url, ''),
  1
from ebook_open_staging s
where publication_title is not null
  and not exists (
    select 1 from titles t
    where t.format = 'ebook_open'
      and ((s.online_identifier is not null
            and s.online_identifier <> ''
            and t.isbn = s.online_identifier)
        or (coalesce(s.online_identifier, '') = ''
            and t.title = s.publication_title
            and t.author = coalesce(s.first_author, '')
            and t.year   = coalesce(s.year, '')))
  );

-- =========================================================================
-- 3. Printed Books — campus-aware
--    The staging table has a campus column you must populate (either via
--    the CSV or by an UPDATE before the insert).
-- =========================================================================
create table if not exists book_printed_staging (
  call_no   text,
  author    text,
  title     text,
  year      text,
  copies    text,    -- accept text so empty cells don't break the import
  publisher text,
  campus    text
);

-- If your CSV has no campus column, set it for every row first:
--   update book_printed_staging set campus = 'Main Campus' where campus is null or campus = '';

insert into titles (format, title, author, publisher, year, call_no, copies, campus)
select
  'book_printed',
  title,
  coalesce(author, ''),
  coalesce(publisher, ''),
  coalesce(year, ''),
  coalesce(call_no, ''),
  coalesce(nullif(copies, '')::int, 1),
  coalesce(campus, '')
from book_printed_staging s
where title is not null and coalesce(campus, '') <> ''
  and not exists (
    select 1 from titles t
    where t.format  = 'book_printed'
      and t.call_no = coalesce(s.call_no, '')
      and t.title   = s.title
      and t.author  = coalesce(s.author, '')
      and t.campus  = coalesce(s.campus, '')
  );

-- =========================================================================
-- 4. Printed Journals — campus-aware
-- =========================================================================
create table if not exists journal_printed_staging (
  call_no   text,
  title     text,
  issn      text,
  editor    text,
  year      text,
  copies    text,
  publisher text,
  campus    text
);

insert into titles (format, title, author, publisher, year, issn, call_no, copies, campus)
select
  'journal_printed',
  title,
  coalesce(editor, ''),
  coalesce(publisher, ''),
  coalesce(year, ''),
  coalesce(issn, ''),
  coalesce(call_no, ''),
  coalesce(nullif(copies, '')::int, 1),
  coalesce(campus, '')
from journal_printed_staging s
where title is not null and coalesce(campus, '') <> ''
  and not exists (
    select 1 from titles t
    where t.format  = 'journal_printed'
      and t.call_no = coalesce(s.call_no, '')
      and t.title   = s.title
      and t.issn    = coalesce(s.issn, '')
      and t.campus  = coalesce(s.campus, '')
  );

-- =========================================================================
-- 5. Subscribed Online Journals
-- =========================================================================
create table if not exists journal_online_paid_staging (
  title     text,
  issn      text,
  publisher text,
  year      text,
  url       text
);

insert into titles (format, title, publisher, year, issn, url, copies)
select 'journal_online_paid', title, coalesce(publisher, ''), coalesce(year, ''),
       coalesce(issn, ''), coalesce(url, ''), 1
from journal_online_paid_staging s
where title is not null
  and not exists (
    select 1 from titles t
    where t.format = 'journal_online_paid'
      and ((s.issn is not null and s.issn <> '' and t.issn = s.issn)
        or (coalesce(s.issn, '') = '' and t.title = s.title))
  );

-- =========================================================================
-- 6. Open Source Online Journals
-- =========================================================================
create table if not exists journal_online_open_staging (
  title     text,
  issn      text,
  publisher text,
  year      text,
  url       text
);

insert into titles (format, title, publisher, year, issn, url, copies)
select 'journal_online_open', title, coalesce(publisher, ''), coalesce(year, ''),
       coalesce(issn, ''), coalesce(url, ''), 1
from journal_online_open_staging s
where title is not null
  and not exists (
    select 1 from titles t
    where t.format = 'journal_online_open'
      and ((s.issn is not null and s.issn <> '' and t.issn = s.issn)
        or (coalesce(s.issn, '') = '' and t.title = s.title))
  );

-- =========================================================================
-- 7. Subjects (one row per subject)
--    The staging table mirrors the subjects upload CSV (Program, Course
--    Code, Course Title, Description). Programs are created on demand
--    via an upsert by name.
-- =========================================================================
create table if not exists subjects_staging (
  program      text,
  course_code  text,
  course_title text,
  description  text
);

-- Step 1 of 2: insert any missing programs.
insert into programs (name)
select distinct trim(program)
from subjects_staging
where program is not null and trim(program) <> ''
on conflict (name) do nothing;

-- Step 2 of 2: insert subjects, joining to the programs table by name and
-- skipping rows that already exist.
insert into subjects (program_id, course_code, course_title, description, sort_order)
select
  p.id,
  coalesce(s.course_code, ''),
  s.course_title,
  coalesce(s.description, ''),
  0
from subjects_staging s
join programs p on p.name = trim(s.program)
where coalesce(s.course_title, '') <> ''
  and not exists (
    select 1 from subjects sub
    where sub.program_id  = p.id
      and sub.course_code = coalesce(s.course_code, '')
      and sub.course_title = s.course_title
  );

-- =========================================================================
-- Cleanup (run after a successful import):
-- truncate ebook_paid_staging, ebook_open_staging,
--          book_printed_staging, journal_printed_staging,
--          journal_online_paid_staging, journal_online_open_staging,
--          subjects_staging;
-- =========================================================================
