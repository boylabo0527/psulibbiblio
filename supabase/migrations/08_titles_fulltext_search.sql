-- Migration: full-text search index for scalable matching. The titles
-- catalog has grown past what /api/match/run can download into a
-- serverless function and rank in memory within one request (500k+ rows).
-- This pushes candidate retrieval into Postgres: for each subject, we ask
-- the database for the handful of titles that actually match its keywords,
-- ranked by relevance, instead of pulling every title every run.
--
-- IMPORTANT: run each of the three blocks below as SEPARATE statements
-- (separate "Run" clicks in the Supabase SQL editor), not pasted together.
-- On a 500k+ row table:
--   - adding the generated column rewrites the whole table to compute it,
--     which is slow enough to hit Supabase's default statement_timeout.
--   - CREATE INDEX CONCURRENTLY can't run inside a multi-statement/implicit
--     transaction block, and is used here specifically so building the
--     index doesn't hold a long lock on titles while the site is live.

-- ---------------------------------------------------------------------------
-- Step 1: add the generated search column (run alone)
-- ---------------------------------------------------------------------------
set statement_timeout = '15min';

alter table titles add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(author, '') || ' ' ||
      coalesce(publisher, '') || ' ' ||
      coalesce(subjects, '')
    )
  ) stored;

-- ---------------------------------------------------------------------------
-- Step 2: build the index CONCURRENTLY (run alone, in its own statement --
-- do not combine with Step 1 or Step 3 in the same "Run")
-- ---------------------------------------------------------------------------
set statement_timeout = '15min';

create index concurrently if not exists titles_search_idx on titles using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Step 3: candidate-retrieval function (run alone)
-- ---------------------------------------------------------------------------
-- Returns up to `limit_n` titles matching the OR-of-terms `query_text`
-- (e.g. "biology | genetics | ecology"), ranked by text-search relevance,
-- across every title format (ebooks, printed books, journals -- no format
-- filter here).
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
