-- Migration: helper function for migrating never-matched titles out to an
-- overflow store (see lib/hostinger-mysql.ts). PostgREST's query builder
-- can't express "titles with no row in assignments" (a NOT EXISTS
-- anti-join) directly, so this does it server-side where it can use
-- assignments_title_idx efficiently, returning one batch per call. Rows
-- already migrated are deleted afterward by the caller, so repeated calls
-- naturally advance -- no cursor/offset needed here.

create or replace function unmatched_titles_batch(p_format text, batch_size int)
returns table (
  id bigint, title text, author text, publisher text, year text,
  isbn text, url text, subjects text, provider text
)
language sql stable
as $$
  select t.id, t.title, t.author, t.publisher, t.year, t.isbn, t.url, t.subjects, t.provider
  from titles t
  where t.format = p_format
    and not exists (select 1 from assignments a where a.title_id = t.id)
  order by t.id
  limit batch_size;
$$;

create or replace function unmatched_titles_count(p_format text)
returns bigint
language sql stable
as $$
  select count(*)
  from titles t
  where t.format = p_format
    and not exists (select 1 from assignments a where a.title_id = t.id);
$$;
