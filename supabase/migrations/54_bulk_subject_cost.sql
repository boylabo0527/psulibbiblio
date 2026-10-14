-- Lets a bulk cost-estimate upload (Procurement Analysis) set many
-- subjects' cost_per_title in one statement instead of one UPDATE per
-- row -- the existing per-subject and per-program/per-campus editors
-- already PATCH one row (or loop PATCHes client-side) at a time, which
-- doesn't scale to a spreadsheet covering a whole program or campus.
-- A NULL entry in p_costs clears that subject's own override (falls back
-- to its program's default again), same as PATCH /api/subjects/:id does.
create or replace function bulk_set_subject_cost(p_subject_ids bigint[], p_costs numeric[])
returns void
language sql
as $$
  update subjects s
  set cost_per_title = u.cost
  from unnest(p_subject_ids, p_costs) as u(subject_id, cost)
  where s.id = u.subject_id;
$$;
