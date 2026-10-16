-- Validate Matches CSV (All Programs)'s apply phase used to issue one
-- update or delete per lock/remove op, each its own Supabase round trip --
-- fine for a single program, but a full-catalog run can queue thousands of
-- them, and at one round trip apiece the apply phase crawls (a couple of
-- writes per second, dominated by network latency rather than actual DB
-- work) even though the underlying writes are trivial. These two RPCs let
-- lib/validate-jobs.ts apply a whole fetched page's worth of locks/removals
-- (up to ITEM_FETCH_BATCH) in one round trip instead of one per row.
create or replace function validate_apply_locks(p_subject_ids bigint[], p_title_ids bigint[])
returns void
language sql
as $$
  update assignments a
  set manual = 1
  from unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  where a.subject_id = u.subject_id and a.title_id = u.title_id;
$$;

-- Keeps the same "never remove a locked row" guard the old per-row delete
-- had (`.eq("manual", 0)`): a row that got manually locked after this job's
-- scan phase queued its removal is left alone rather than deleted out from
-- under whoever locked it.
create or replace function validate_apply_removes(p_subject_ids bigint[], p_title_ids bigint[])
returns void
language sql
as $$
  delete from assignments a
  using unnest(p_subject_ids, p_title_ids) as u(subject_id, title_id)
  where a.subject_id = u.subject_id and a.title_id = u.title_id and a.manual = 0;
$$;
