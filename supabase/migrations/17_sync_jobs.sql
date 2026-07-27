-- Migration: resumable background sync jobs.
--
-- A Destiny sync (or any future large automated feed) can easily involve
-- tens of thousands of rows -- far more than fits in one Vercel function
-- invocation on the Hobby (free) plan, which kills a request well before
-- that much work finishes. Rather than do the whole thing in one long
-- request, work is split into three steps:
--   1. "start" fetches + plans the work and writes it here as a queue of
--      small ops (sync_job_items), one per title.
--   2. "continue" is called repeatedly (each call time-boxed well under
--      the plan's limit); it works through the queue a chunk at a time
--      and persists progress to sync_jobs.
--   3. "status" reads the same row, so progress survives a page reload or
--      a closed tab -- it isn't tied to one HTTP connection staying open.

create table if not exists sync_jobs (
  id                uuid primary key,
  kind              text not null,
  status            text not null default 'running',  -- running | done | error
  total             int not null default 0,
  inserted          int not null default 0,
  updated           int not null default 0,
  duplicates        int not null default 0,
  no_campus_titles  jsonb not null default '[]'::jsonb,
  unmapped_campuses jsonb not null default '[]'::jsonb,
  error             text,
  batch_id          uuid,
  created_by        text default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists sync_jobs_kind_created_idx on sync_jobs (kind, created_at desc);

create table if not exists sync_job_items (
  id     bigserial primary key,
  job_id uuid not null references sync_jobs(id) on delete cascade,
  seq    int not null,
  op     jsonb not null
);
create index if not exists sync_job_items_job_seq_idx on sync_job_items (job_id, seq);

-- Same rationale as activity_log: holds nothing the anon key ever needs,
-- and only server routes (using the service role) touch these tables.
alter table sync_jobs enable row level security;
alter table sync_job_items enable row level security;
