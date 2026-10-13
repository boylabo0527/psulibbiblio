-- Tracks (subject_id, title_id) pairs a librarian has explicitly decided
-- do NOT belong to that course -- via the single-item "Remove" action
-- (app/api/match/override) or a Validate Matches CSV upload marking a
-- title not applicable. Match's delete-then-reinsert cycle
-- (app/api/match/run/route.ts) only ever removes/replaces manual=0 rows
-- and has no memory of a prior human decision once that row is gone, so
-- a title a librarian already rejected for a course just comes right
-- back on the next run if full-text search still ranks it -- there was
-- previously no record of that decision anywhere once the assignment
-- row itself was deleted.
create table if not exists rejected_matches (
  subject_id bigint not null references subjects(id) on delete cascade,
  title_id bigint not null references titles(id) on delete cascade,
  rejected_at timestamptz not null default now(),
  rejected_by text,
  primary key (subject_id, title_id)
);

-- Locking a match is an explicit "this belongs" decision -- clears any
-- earlier rejection of the same pair so a future unlock+rematch isn't
-- fighting a stale record.
create or replace function validate_apply_locks(p_subject_ids bigint[], p_title_ids bigint[])
returns void
language sql
as $$
  update assignments a
  set manual = 1
  from unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  where a.subject_id = u.subject_id and a.title_id = u.title_id;

  delete from rejected_matches r
  using unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  where r.subject_id = u.subject_id and r.title_id = u.title_id;
$$;

-- Keeps the same "never remove a locked row" guard the old per-row delete
-- had (`.eq("manual", 0)`): a row that got manually locked after this job's
-- scan phase queued its removal is left alone rather than deleted out from
-- under whoever locked it. Also records the rejection so Match's next run
-- doesn't just re-suggest the same title for the same course.
create or replace function validate_apply_removes(p_subject_ids bigint[], p_title_ids bigint[])
returns void
language sql
as $$
  delete from assignments a
  using unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  where a.subject_id = u.subject_id and a.title_id = u.title_id and a.manual = 0;

  insert into rejected_matches (subject_id, title_id)
  select subject_id, title_id from unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  on conflict (subject_id, title_id) do update set rejected_at = now();
$$;
