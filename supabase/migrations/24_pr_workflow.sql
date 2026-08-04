-- Migration: admin-configurable approval workflow for Purchase Requests --
-- the ordered list of offices a PR passes through (e.g. Library -> Budget
-- Office -> Accounting -> President), used both to track where a PR
-- currently sits and as the basis for a "pending too long" flag in
-- Monitoring (15+ days in the same office). Email reminders are not wired
-- up yet -- this just gives Monitoring the data to flag things in-app.
--
-- pr_workflow_steps: the admin-defined sequence, shared by every PR (not
--   per-PR) -- reordering/renaming/adding/removing here changes what
--   "next step" means for every PR going forward. seq is 1-based and
--   must stay contiguous within itself (enforced in application code, not
--   the database, same as role_tab_permissions' lack of a check
--   constraint elsewhere in this schema).
-- pr_step_history: audit trail -- one row per (purchase_request, seq) the
--   PR has passed through, with entered_at/left_at so "how long did it
--   sit in the Budget Office" is answerable later even after workflow
--   steps are edited.

create table if not exists pr_workflow_steps (
  id bigserial primary key,
  seq int not null unique,
  office_name text not null,
  created_at timestamptz default now()
);

alter table purchase_requests add column if not exists current_step_seq int;
alter table purchase_requests add column if not exists step_entered_at timestamptz default now();
alter table purchase_requests add column if not exists status text not null default 'in_progress';
alter table purchase_requests drop constraint if exists purchase_requests_status_check;
alter table purchase_requests add constraint purchase_requests_status_check
  check (status in ('in_progress', 'completed'));
alter table purchase_requests add column if not exists completed_at timestamptz;

create table if not exists pr_step_history (
  id bigserial primary key,
  purchase_request_id bigint not null references purchase_requests(id) on delete cascade,
  seq int not null,
  office_name text not null,
  entered_at timestamptz not null default now(),
  left_at timestamptz,
  moved_by text default '',
  notes text default ''
);
create index if not exists pr_step_history_pr_idx on pr_step_history(purchase_request_id);

alter table pr_workflow_steps enable row level security;
alter table pr_step_history enable row level security;
