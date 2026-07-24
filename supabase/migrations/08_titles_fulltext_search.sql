-- Migration: full-text search index for scalable matching. The titles
-- catalog has grown past what /api/match/run can download into a
-- serverless function and rank in memory within one request (500k+ rows).
-- This pushes candidate retrieval into Postgres: for each subject, we ask
-- the database for the handful of titles that actually match its keywords,
-- ranked by relevance, instead of pulling every title every run.
--
-- IMPORTANT: run each of the three blocks below as SEPARATE statements
-- (separate "Run" clicks in the Supabase SQL editor), not pasted together.
-- On a 500k+ row table, adding the generated column rewrites the whole
-- table to compute it, which is slow enough to hit Supabase's default
-- statement_timeout.
--
-- Step 2 uses a plain CREATE INDEX, not CONCURRENTLY -- Supabase's SQL
-- editor runs every query inside an implicit transaction block, and
-- CONCURRENTLY is rejected inside one ("cannot run inside a transaction
-- block"). A plain CREATE INDEX takes a lock that blocks writes (uploads)
-- to titles for as long as the build takes, but reads keep working; run it
-- at a quiet time if you can.

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
-- Step 2: build the index (run alone, in its own statement -- do not
-- combine with Step 1 or Step 3 in the same "Run")
-- ---------------------------------------------------------------------------
set statement_timeout = '15min';

create index if not exists titles_search_idx on titles using gin (search_vector);

-- ---------------------------------------------------------------------------
-- Step 3: candidate-retrieval function (run alone)
-- ---------------------------------------------------------------------------
-- Returns up to `limit_n` titles, combining two searches:
--   - must_text: an AND-of-terms phrase built from the subject's course
--     title/code (e.g. "constitutional & law"). This is deliberately
--     selective, so it's never subject to the row cap below -- every
--     matching row gets ranked. This is what guarantees a book whose own
--     title literally is the subject's topic (e.g. "Constitutional law")
--     is never lost, however common a catalog of 500k+ titles makes it.
--   - query_text: the broader OR-of-terms query (e.g. "biology | genetics
--     | ecology") for recall beyond an exact title-phrase match.
--
-- The broad side's inner LIMIT (with no ORDER BY) is what keeps IT fast:
-- ts_rank_cd() has to be computed for every row matching the tsquery
-- before Postgres can sort and return the top N, and for a subject whose
-- keywords include common words, that match set can be a huge share of a
-- 500k+ row table -- easily enough to blow through a statement timeout on
-- its own, AND (before the must_text split) risked silently dropping a
-- genuinely relevant title if it didn't happen to land in that first
-- unordered batch. Splitting the query this way means that risk now only
-- applies to the supplementary broad matches, not to an exact title-phrase
-- hit.
-- is_must_match tells the caller a title's own text literally contains the
-- subject's core topic phrase (not just some of the broader OR terms) --
-- ts_rank_cd (no length normalization) otherwise rewards a keyword-richer
-- but less canonical competing title over a sparse, minimally-catalogued
-- classic text that's actually the better match, so the caller uses this
-- flag to give such titles a scoring floor rather than relying on raw rank
-- alone.
create or replace function match_titles_candidates(query_text text, must_text text, limit_n int)
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
as $$
  with must_matches as (
    -- must_text is an AND of a handful of course-title words, so this is
    -- normally small (rarely more than a few dozen rows) -- but a subject
    -- titled with just one very common word (e.g. "Statistics") could still
    -- match thousands, so this keeps a generous but real cap as a backstop.
    select t.id, ts_rank_cd(t.search_vector, to_tsquery('english', must_text)) as lexical_rank, true as is_must
    from titles t
    where must_text is not null and must_text <> ''
      and t.search_vector @@ to_tsquery('english', must_text)
    limit 20000
  ),
  broad_matches as (
    select t.id, ts_rank_cd(t.search_vector, to_tsquery('english', query_text)) as lexical_rank, false as is_must
    from titles t
    where t.search_vector @@ to_tsquery('english', query_text)
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
  -- is_must_match must be ordered first, not just returned as a flag: this
  -- LIMIT is where candidates actually get cut down to limit_n, inside the
  -- database. ts_rank_cd has no length normalization, so a short, sparsely
  -- catalogued exact-title match (e.g. a title that's just "Constitutional
  -- law") can score a lower raw lexical_rank than dozens of broader OR
  -- matches that merely share more individual words. Ordering by
  -- lexical_rank alone let those broader matches fill the limit_n slots
  -- and silently cut the true match before it ever reached the caller --
  -- the caller's own is_must_match re-ranking can't recover a candidate
  -- that was never in the returned set to begin with.
  order by g.is_must_match desc, g.lexical_rank desc
  limit limit_n;
$$;

drop function if exists match_titles_candidates(text, int);
