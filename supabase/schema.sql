-- Supabase schema for PSU per-program subject bibliographies.
-- Run in the SQL Editor of your Supabase project.
--
-- WARNING: this script is destructive. It drops any existing
-- programs / subjects / titles / assignments / matches / courses tables
-- so the schema can be re-applied cleanly. The data model went through
-- a breaking change (titles gained `format` / `call_no` / `copies`,
-- matches became assignments, programs and subjects were added) so an
-- in-place migration would be more confusing than a clean rebuild.
-- If you have data you need to keep, export it first.

drop table if exists assignments cascade;
drop table if exists matches     cascade;  -- old name; harmless if absent
drop table if exists subjects    cascade;
drop table if exists courses     cascade;  -- old name; harmless if absent
drop table if exists titles      cascade;
drop table if exists programs    cascade;

-- A program is curriculum-only (no campus). The same program can exist
-- physically at multiple campuses; campus matters only for printed titles.
create table if not exists programs (
  id         bigserial primary key,
  name       text not null,            -- e.g. "BA Political Science"
  created_at timestamptz default now()
);
create unique index if not exists programs_unique on programs (name);

-- A subject (course) sits under a program. Sections / curricular groupings
-- were dropped to keep the upload CSV minimal.
create table if not exists subjects (
  id           bigserial primary key,
  program_id   bigint not null references programs(id) on delete cascade,
  course_code  text default '',          -- e.g. "PSM 1"
  course_title text not null,            -- e.g. "Fundamentals of Political Science"
  description  text default '',
  sort_order   int  default 0,
  created_at   timestamptz default now()
);
create index if not exists subjects_program_idx on subjects (program_id);

-- A title is a book record. format=ebook (Perlego / Kavita) or printed
-- (library catalog row with call number and copies).
create table if not exists titles (
  id         bigserial primary key,
  format     text not null check (format in (
    'ebook_paid', 'ebook_open',
    'book_printed',
    'journal_printed',
    'journal_online_paid', 'journal_online_open'
  )),
  title      text not null,
  author     text default '',
  publisher  text default '',
  year       text default '',
  isbn       text default '',
  issn       text default '',
  call_no    text default '',
  copies     int  default 1,
  url        text default '',
  subjects   text default '',
  campus     text default '',
  created_at timestamptz default now()
);
create index if not exists titles_format_idx on titles (format);
create index if not exists titles_isbn_idx   on titles (isbn);
create index if not exists titles_issn_idx   on titles (issn);
create index if not exists titles_callno_idx on titles (call_no);
create index if not exists titles_campus_idx on titles (campus);
create index if not exists titles_title_idx  on titles (title);

-- Assignment of a title to a subject. manual=1 means a librarian pinned
-- or added this row; manual=0 is auto-matched and will be replaced on
-- the next match run.
create table if not exists assignments (
  id          bigserial primary key,
  subject_id  bigint not null references subjects(id) on delete cascade,
  title_id    bigint not null references titles(id)   on delete cascade,
  score       double precision default 0,
  rank        int default 0,
  explanation text default '',
  manual      int default 0,
  created_at  timestamptz default now(),
  unique (subject_id, title_id)
);
create index if not exists assignments_subject_idx on assignments (subject_id);
create index if not exists assignments_title_idx   on assignments (title_id);

alter table programs    enable row level security;
alter table subjects    enable row level security;
alter table titles      enable row level security;
alter table assignments enable row level security;

do $$ begin
  create policy "anon read programs"    on programs    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read subjects"    on subjects    for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read titles"      on titles      for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read assignments" on assignments for select using (true);
exception when duplicate_object then null; end $$;
