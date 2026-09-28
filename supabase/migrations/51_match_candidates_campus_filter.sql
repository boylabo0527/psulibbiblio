-- Lets a Match run restrict campus-scoped formats (book_printed,
-- journal_printed -- see RESOURCE_TYPES' campusScoped flag in
-- lib/resources.ts) to one campus's own catalog, e.g. so matching a
-- program offered at PSU-ROXAS doesn't hand it printed books that only
-- physically sit at Main Campus and can't actually satisfy PSU-ROXAS's own
-- printed-book accreditation requirement (see /api/procurement, which
-- already scopes book_printed/journal_printed the same way).
--
-- Non-campus-scoped formats (eBooks, online journals, repository) are
-- never campus-scoped in the first place, so p_campus leaves them
-- untouched -- only rows whose format is in p_campus_scoped_formats are
-- filtered by campus. p_campus/p_campus_scoped_formats both default to
-- null (no filter), so every existing caller's behavior is unchanged.
create or replace function match_titles_candidates(
  query_text text, must_text text, limit_n int, formats text[] default null,
  p_campus text default null, p_campus_scoped_formats text[] default null
)
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
      and (p_campus is null or not (t.format = any(p_campus_scoped_formats)) or t.campus = p_campus)
    limit 20000
  ),
  broad_matches as (
    select t.id, ts_rank_cd(t.search_vector, to_tsquery('english', query_text)) as lexical_rank, false as is_must
    from titles t
    where t.search_vector @@ to_tsquery('english', query_text)
      and (formats is null or t.format = any(formats))
      and (p_campus is null or not (t.format = any(p_campus_scoped_formats)) or t.campus = p_campus)
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
