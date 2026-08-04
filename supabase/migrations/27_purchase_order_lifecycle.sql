-- Migration: Purchase Orders gain a status/cancel lifecycle, same as
-- Purchase Requests (see 26_pr_cancel_and_po.sql). Previously a PO was
-- generate-only with no way to edit or void it, and regenerating one for
-- the same supplier would silently re-include items already on a prior
-- active PO -- cancelled_at existing here (mirroring purchase_requests)
-- is what makes "cancel frees the items back up" a coherent operation.

alter table purchase_orders add column if not exists status text not null default 'active';
alter table purchase_orders drop constraint if exists purchase_orders_status_check;
alter table purchase_orders add constraint purchase_orders_status_check
  check (status in ('active', 'cancelled'));
alter table purchase_orders add column if not exists cancelled_at timestamptz;
