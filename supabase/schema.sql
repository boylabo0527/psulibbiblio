-- Supabase schema for PSU Bibliography Generator.
-- Run this once in the SQL Editor of your Supabase project.

create table if not exists titles (
  id          bigserial primary key,
  title       text not null,
  author      text default '',
  publisher   text default '',
  year        text default '',
  isbn        text default '',
  edition     text default '',
  url         text default '',
  subjects    text default '',
  created_at  timestamptz default now()
);
create index if not exists titles_isbn_idx on titles (isbn);
create index if not exists titles_title_idx on titles (title);

create table if not exists courses (
  id                bigserial primary key,
  campus            text default '',
  college           text default '',
  program           text default '',
  major             text default '',
  course_code       text default '',
  course_title      text not null,
  description       text default '',
  learning_outcomes text default '',
  keywords          text default '',
  enrollment        int  default 0,
  created_at        timestamptz default now()
);
create index if not exists courses_campus_idx  on courses (campus);
create index if not exists courses_college_idx on courses (college);
create index if not exists courses_program_idx on courses (program);

create table if not exists matches (
  id          bigserial primary key,
  course_id   bigint not null references courses(id) on delete cascade,
  title_id    bigint not null references titles(id)  on delete cascade,
  score       double precision not null default 0,
  rank        int    not null default 0,
  explanation text default '',
  overridden  int    not null default 0,
  created_at  timestamptz default now(),
  unique (course_id, title_id)
);
create index if not exists matches_course_idx on matches (course_id);
create index if not exists matches_title_idx  on matches (title_id);

-- Row Level Security: turn it on but provide a single permissive policy
-- since this MVP uses the service-role key from server-side routes only.
-- Tighten this when adding auth.
alter table titles  enable row level security;
alter table courses enable row level security;
alter table matches enable row level security;

-- Allow anonymous read for browse endpoints if desired. Writes go through
-- server routes using the service role, so they bypass RLS.
do $$ begin
  create policy "anon read titles"  on titles  for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read courses" on courses for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read matches" on matches for select using (true);
exception when duplicate_object then null; end $$;
