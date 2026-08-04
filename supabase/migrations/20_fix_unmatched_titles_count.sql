-- Migration: unmatched_titles_count() as originally written does a
-- NOT EXISTS anti-join over the whole titles table, which (unlike
-- unmatched_titles_batch, which can stop as soon as it's found
-- batch_size rows) has no way to short-circuit -- it has to touch nearly
-- every one of 500k+ rows to produce an exact count, and that's slow
-- enough to hit the statement timeout on Supabase's free tier.
--
-- Rewritten to compute the same number as a subtraction of two cheap
-- queries instead: a plain count-by-format (fast, uses titles_format_idx)
-- minus a count of assigned titles starting from the small assignments
-- table and joining out to titles, rather than the other way around.

create or replace function unmatched_titles_count(p_format text)
returns bigint
language sql stable
set statement_timeout = '25s'
as $$
  select
    (select count(*) from titles t where t.format = p_format)
    -
    (select count(distinct a.title_id)
     from assignments a
     join titles t on t.id = a.title_id
     where t.format = p_format);
$$;

-- Defensive timeout on the batch function too, even though LIMIT lets it
-- stop early -- matches match_titles_candidates' own reasoning (see
-- 08_titles_fulltext_search.sql): the API role's default statement_timeout
-- can be shorter than what an admin sees running things by hand.
create or replace function unmatched_titles_batch(p_format text, batch_size int)
returns table (
  id bigint, title text, author text, publisher text, year text,
  isbn text, url text, subjects text, provider text
)
language sql stable
set statement_timeout = '25s'
as $$
  select t.id, t.title, t.author, t.publisher, t.year, t.isbn, t.url, t.subjects, t.provider
  from titles t
  where t.format = p_format
    and not exists (select 1 from assignments a where a.title_id = t.id)
  order by t.id
  limit batch_size;
$$;
