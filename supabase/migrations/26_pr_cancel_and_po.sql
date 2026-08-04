-- Migration: lets a Purchase Request be cancelled (freeing its line items
-- so they can be requested again, since the "already requested" duplicate
-- check only looks at non-cancelled PRs -- see /api/purchase-request/requested-ids),
-- and adds the purchase_orders table for consolidating a supplier's
-- accepted requests into a single PO document (mirrors purchase_requests'
-- shape/reasoning, see 22_purchase_request_records.sql).

alter table purchase_requests drop constraint if exists purchase_requests_status_check;
alter table purchase_requests add constraint purchase_requests_status_check
  check (status in ('in_progress', 'completed', 'cancelled'));
alter table purchase_requests add column if not exists cancelled_at timestamptz;

create table if not exists purchase_orders (
  id bigserial primary key,
  po_no text not null default '',
  trans_no text default '',
  philgeps_ref_no text default '',
  supplier text not null default '',
  address text default '',
  tin text default '',
  mode_of_procurement text default '',
  place_of_delivery text default '',
  delivery_term text default '',
  date_of_delivery text default '',
  payment_term text default '',
  fund_cluster text default '',
  ors_burs_no text default '',
  date_of_ors_burs text default '',
  po_date text default '',
  items jsonb not null default '[]'::jsonb,
  total_amount numeric not null default 0,
  generated_by text not null default '',
  created_at timestamptz default now()
);
create index if not exists purchase_orders_created_at_idx on purchase_orders(created_at desc);
create index if not exists purchase_orders_supplier_idx on purchase_orders(supplier);

alter table purchase_orders enable row level security;
