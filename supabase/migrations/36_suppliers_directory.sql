-- Migration: a directory of known suppliers (address, contact person,
-- phone, email, TIN) -- previously that info only ever existed as
-- free-typed text on canvassing rows and Purchase Order header fields,
-- retyped from scratch every time. This is a reference list for account
-- creation/coordination and to autofill a new PO's address/TIN.
create table if not exists suppliers (
  id              bigserial primary key,
  name            text not null,
  address         text default '',
  contact_person  text default '',
  phone           text default '',
  email           text default '',
  tin             text default '',
  notes           text default '',
  created_by      text default '',
  created_at      timestamptz default now()
);
create unique index if not exists suppliers_name_unique on suppliers (lower(name));

alter table suppliers enable row level security;
do $$ begin
  create policy "anon read suppliers" on suppliers for select using (true);
exception when duplicate_object then null; end $$;
