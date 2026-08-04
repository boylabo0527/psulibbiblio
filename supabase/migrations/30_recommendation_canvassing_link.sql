-- Migration: let a faculty title recommendation carry forward a link to an
-- already-canvassed/priced title, when it was added from the "browse
-- what's already been canvassed" shopping-cart list on the Faculty
-- Recommendations tab instead of typed in from scratch. Nullable -- a
-- manually-typed recommendation (no matching canvassed title yet) still
-- has none.
alter table title_recommendations add column if not exists canvassing_id bigint references canvassing(id) on delete set null;
create index if not exists title_recommendations_canvassing_idx on title_recommendations(canvassing_id);
