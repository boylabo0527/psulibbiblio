-- Migration: the library committee's authoritative "standard titles" list
-- per course -- the titles a committee has decided a course should have,
-- set/uploaded in bulk by an admin, independent of whatever's actually in
-- the catalog. A new Standard Titles tab compares the two so staff can see
-- which standard titles are still missing from the catalog, course by
-- course, instead of only tracking a bare count of titles needed.
create table if not exists standard_titles (
  id          bigserial primary key,
  subject_id  bigint not null references subjects(id) on delete cascade,
  title       text not null,
  author      text default '',
  publisher   text default '',
  year        text default '',
  isbn        text default '',
  notes       text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);
create index if not exists standard_titles_subject_idx on standard_titles (subject_id);

alter table standard_titles enable row level security;
do $$ begin
  create policy "anon read standard_titles" on standard_titles for select using (true);
exception when duplicate_object then null; end $$;
