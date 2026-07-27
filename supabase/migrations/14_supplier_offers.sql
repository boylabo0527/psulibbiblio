-- Migration: lets a Supplier submit an offer (title, price, availability)
-- against a specific need, instead of just viewing a static list. Staff
-- (anyone with Procurement Analysis view access, or an admin) review and
-- accept/decline offers; suppliers only ever see their own.

create table if not exists supplier_offers (
  id           bigserial primary key,
  subject_id   bigint references subjects(id) on delete set null,
  supplier_email text not null,
  title        text not null,
  author       text default '',
  format       text default '',
  price        numeric,
  notes        text default '',
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz default now(),
  decided_at   timestamptz,
  decided_by   text default ''
);
create index if not exists supplier_offers_subject_idx on supplier_offers (subject_id);
create index if not exists supplier_offers_status_idx  on supplier_offers (status);
create index if not exists supplier_offers_email_idx   on supplier_offers (supplier_email);

alter table supplier_offers enable row level security;

-- Submitting an offer is now the Supplier role's core action on the
-- Supplier View tab, not just viewing -- grant can_edit there too.
update role_tab_permissions
set can_edit = true
where tab_id = 'supplier-view'
  and role_id in (select id from roles where name = 'Supplier');
