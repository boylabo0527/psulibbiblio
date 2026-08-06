-- Migration: tags a Purchase Order's delivery status (not yet delivered /
-- partially delivered / delivered) instead of only tracking whether the
-- PO document itself was generated -- Monitoring previously had no way to
-- record that a supplier had actually fulfilled an order.
alter table purchase_orders add column if not exists delivery_status text not null default 'pending' check (delivery_status in ('pending', 'partial', 'delivered'));
alter table purchase_orders add column if not exists delivered_at timestamptz;
alter table purchase_orders add column if not exists delivery_notes text default '';
create index if not exists purchase_orders_delivery_status_idx on purchase_orders (delivery_status);
