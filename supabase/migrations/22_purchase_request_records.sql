-- Migration: persist a record of every generated Purchase Request, so the
-- new Monitoring tab can list them (who submitted, when, what, how much).
-- Previously /api/purchase-request only streamed back an .xlsx file --
-- nothing was ever saved. This table is written to in addition to that
-- download, which is unchanged.

create table if not exists purchase_requests (
  id bigserial primary key,
  pr_no text not null default '',
  submitted_by text not null default '',
  entity_name text default '',
  office text default '',
  fund_cluster text default '',
  rc_code text default '',
  purpose text default '',
  requested_by text default '',
  approved_by text default '',
  pr_date text default '',
  items jsonb not null default '[]'::jsonb,
  total_amount numeric not null default 0,
  created_at timestamptz default now()
);

create index if not exists purchase_requests_created_at_idx on purchase_requests(created_at desc);

alter table purchase_requests enable row level security;
