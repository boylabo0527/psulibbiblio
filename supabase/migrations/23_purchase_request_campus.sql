-- Migration: attribute each Purchase Request to a campus, so Monitoring
-- can group/consolidate spend by campus (and, alongside campus_budgets in
-- 25_campus_budgets.sql, flag which campuses are over/under their budget).
-- campus is kept as free text too (not just campus_id) since a PR can be
-- generated with "All campuses" selected (cross-campus/unspecified) in
-- Purchase Request tab today -- campus_id is null in that case.

alter table purchase_requests add column if not exists campus text default '';
alter table purchase_requests add column if not exists campus_id bigint references campuses(id) on delete set null;

create index if not exists purchase_requests_campus_id_idx on purchase_requests(campus_id);
