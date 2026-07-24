-- Migration: full-text search index for scalable matching. The titles
-- catalog has grown past what /api/match/run can download into a
-- serverless function and rank in memory within one request (500k+ rows).
-- This pushes candidate retrieval into Postgres: for each subject, we ask
-- the database for the handful of titles that actually match its keywords,
-- ranked by relevance, instead of pulling every title every run.
--
-- NOTE: adding a generated column on a 500k+ row table rewrites the whole
-- table, and building the GIN index below scans it again -- this migration
-- can take a few minutes on a large catalog. That's expected; let it run.

alter table titles add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(author, '') || ' ' ||
      coalesce(publisher, '') || ' ' ||
      coalesce(subjects, '')
    )
  ) stored;

create index if not exists titles_search_idx on titles using gin (search_vector);

-- Returns up to `limit_n` titles matching the OR-of-terms `query_text`
-- (e.g. "biology | genetics | ecology"), ranked by text-search relevance.
-- SQL function (not a view) so a single round trip both searches and
-- ranks server-side.
create or replace function match_titles_candidates(query_text text, limit_n int)
returns table (
  id bigint,
  format text,
  title text,
  author text,
  publisher text,
  year text,
  subjects text,
  embedding jsonb,
  lexical_rank real
)
language sql stable
as $$
  select t.id, t.format, t.title, t.author, t.publisher, t.year, t.subjects,
         t.embedding, ts_rank_cd(t.search_vector, to_tsquery('english', query_text)) as lexical_rank
  from titles t
  where t.search_vector @@ to_tsquery('english', query_text)
  order by lexical_rank desc
  limit limit_n;
$$;
