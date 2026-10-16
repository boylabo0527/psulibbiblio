-- Lets a Match run be restricted to specific resource types (e.g. "only
-- online journals") by filtering candidates *before* the LIMIT that caps
-- match_titles_candidates' result to limit_n. Filtering the returned
-- candidates afterward (in application code) isn't enough: that LIMIT is
-- format-agnostic, ordered purely by lexical rank, so a target format that's
-- a small slice of the catalog (or just scores lower lexically than the
-- rest of the catalog for a given subject) could be crowded out of the top
-- limit_n entirely, with nothing left for a post-hoc filter to keep even
-- though real matches exist. `formats` defaults to null (no filter), so
-- every existing caller's behavior is unchanged.
create or replace function match_titles_candidates(query_text text, must_text text, limit_n int, formats text[] default null)
returns table (
  id bigint,
  format text,
  title text,
  author text,
  publisher text,
  year text,
  subjects text,
  embedding jsonb,
  lexical_rank real,
  is_must_match boolean
)
language sql stable
set statement_timeout = '30s'
as $$
  with must_matches as (
    select t.id, ts_rank_cd(t.search_vector, to_tsquery('english', must_text)) as lexical_rank, true as is_must
    from titles t
    where must_text is not null and must_text <> ''
      and t.search_vector @@ to_tsquery('english', must_text)
      and (formats is null or t.format = any(formats))
    limit 20000
  ),
  broad_matches as (
    select t.id, ts_rank_cd(t.search_vector, to_tsquery('english', query_text)) as lexical_rank, false as is_must
    from titles t
    where t.search_vector @@ to_tsquery('english', query_text)
      and (formats is null or t.format = any(formats))
    limit greatest(limit_n * 20, 6000)
  ),
  grouped as (
    select id, max(lexical_rank) as lexical_rank, bool_or(is_must) as is_must_match
    from (select * from must_matches union all select * from broad_matches) combined
    group by id
  )
  select t.id, t.format, t.title, t.author, t.publisher, t.year, t.subjects, t.embedding,
         g.lexical_rank, g.is_must_match
  from grouped g
  join titles t on t.id = g.id
  order by g.is_must_match desc, g.lexical_rank desc
  limit limit_n;
$$;
