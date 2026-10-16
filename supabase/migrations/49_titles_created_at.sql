-- Tracks when a title row was actually added, so growth can be reported
-- over time (e.g. GET /api/public/online-materials-count?by=quarter).
-- titles predates this app's migration history and never had a
-- created_at column, so adding one with `default now()` backfills every
-- EXISTING row with the single moment this migration runs (Postgres
-- evaluates a volatile default once for an ALTER, not per row) -- that's
-- not a real historical acquisition date, just "everything catalogued
-- before quarterly tracking started." created_at_backfilled marks
-- exactly those rows so reporting code can tell them apart from titles
-- added after this ships, rather than showing a misleading one-quarter
-- spike of thousands of "new" titles.
alter table titles add column if not exists created_at timestamptz default now();
alter table titles add column if not exists created_at_backfilled boolean not null default false;
update titles set created_at_backfilled = true where created_at_backfilled is false;
