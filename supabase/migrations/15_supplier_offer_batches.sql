-- Migration: lets a supplier submit several titles against one subject in a
-- single action (e.g. a course needing 3 more titles), instead of repeating
-- the whole offer form once per title. batch_id groups the rows submitted
-- together in one go so the UI can show them as one submission; nullable
-- since existing single-title offers predate this and have no batch.
alter table supplier_offers add column if not exists batch_id uuid;
create index if not exists supplier_offers_batch_idx on supplier_offers (batch_id);
