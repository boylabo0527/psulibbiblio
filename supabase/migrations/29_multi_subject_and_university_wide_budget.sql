-- Migration: let one canvassed/purchased title count toward more than one
-- course's compliance gap (e.g. a general-education ebook relevant to
-- three different subjects), and let a Purchase Request that isn't tied to
-- one physical campus (typically ebook-only requests) still be tracked
-- against a budget instead of disappearing from Monitoring's spend totals.

-- canvassing.subject_id remains the "primary" course a title was canvassed
-- for (unchanged -- every existing query/UI that reads it keeps working).
-- canvassing_subjects is the full set including that primary, so "which
-- courses does this title count toward" always means "read this table",
-- while "what course was this canvassed for" still means the subject_id
-- column. Backfill copies every existing assignment in as the primary.
create table if not exists canvassing_subjects (
  id            bigserial primary key,
  canvassing_id bigint not null references canvassing(id) on delete cascade,
  subject_id    bigint not null references subjects(id) on delete cascade,
  created_at    timestamptz default now()
);
create unique index if not exists canvassing_subjects_unique on canvassing_subjects(canvassing_id, subject_id);
create index if not exists canvassing_subjects_subject_idx on canvassing_subjects(subject_id);

insert into canvassing_subjects (canvassing_id, subject_id)
select id, subject_id from canvassing where subject_id is not null
on conflict (canvassing_id, subject_id) do nothing;

alter table canvassing_subjects enable row level security;
do $$ begin
  create policy "anon read canvassing_subjects" on canvassing_subjects for select using (true);
exception when duplicate_object then null; end $$;

-- campus_budgets.campus_id becomes nullable: null means "University-wide /
-- Digital" -- a budget line for spend that isn't scoped to one campus,
-- instead of that spend silently being excluded from every campus's
-- budget-vs-spent total. Postgres already treats two NULLs as distinct for
-- a normal unique index, so a separate partial index enforces "one
-- university-wide budget per period" the same way the regular index
-- enforces "one budget per campus per period".
alter table campus_budgets alter column campus_id drop not null;
create unique index if not exists campus_budgets_university_wide_unique
  on campus_budgets(period) where campus_id is null;
