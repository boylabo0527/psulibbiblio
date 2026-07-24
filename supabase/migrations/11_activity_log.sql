-- Migration: activity log for auditing who did what, plus upload-batch
-- tracking so a bad/failed upload can be reverted.
--
-- batch_id ties every row inserted by one upload together, so "revert this
-- upload" can delete exactly those rows without touching anything that
-- existed before or was added by a different upload.

alter table titles   add column if not exists batch_id uuid;
alter table subjects add column if not exists batch_id uuid;
create index if not exists titles_batch_idx   on titles (batch_id);
create index if not exists subjects_batch_idx on subjects (batch_id);

create table if not exists activity_log (
  id          bigserial primary key,
  created_at  timestamptz default now(),
  user_email  text default '',
  action      text not null,
  summary     text not null,
  detail      jsonb default '{}'::jsonb,
  batch_id    uuid,
  revertible  boolean default false,
  reverted_at timestamptz
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);
create index if not exists activity_log_batch_idx   on activity_log (batch_id);

-- No anon read policy -- unlike the other tables, this one holds user
-- emails and audit detail, and nothing in the app queries it with the anon
-- key. RLS enabled with no policies means only the service role (used by
-- every API route here) can read it.
alter table activity_log enable row level security;
