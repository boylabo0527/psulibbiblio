-- Migration: lets a supplier tie an offer back to the specific faculty
-- recommendation it responds to, and say whether it's the exact title
-- requested or an alternative -- without this, staff (and the supplier's
-- own submission form) had no way to see the faculty-requested title's
-- full detail or record that choice.
alter table supplier_offers add column if not exists recommendation_id bigint references title_recommendations(id) on delete set null;
alter table supplier_offers add column if not exists match_type text check (match_type in ('exact', 'alternative'));
create index if not exists supplier_offers_recommendation_idx on supplier_offers (recommendation_id);
