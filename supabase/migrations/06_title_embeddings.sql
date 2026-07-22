-- Migration: cache computed sentence-embedding vectors on titles so the
-- matcher doesn't have to re-embed the whole catalog on every run — only
-- titles with a null embedding get (re-)computed.

alter table titles add column if not exists embedding jsonb;
