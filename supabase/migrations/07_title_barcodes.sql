-- Migration: track which barcodes/accession numbers have already been
-- counted for a printed title, so re-uploading the same library catalog
-- export doesn't inflate the copy count every time — only genuinely new
-- barcodes increment copies.

alter table titles add column if not exists barcodes jsonb default '[]'::jsonb;
