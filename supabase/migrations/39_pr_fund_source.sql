-- Migration: tags a Purchase Request with its fund source (e.g. "MOOE",
-- "Capital Outlay") -- the real TOR documents this app now generates (see
-- /api/tor) title themselves by fund source ("PROCUREMENT ... UNDER MOOE"
-- vs "... UNDER CAPITAL OUTLAY"), so it needs to be captured somewhere
-- rather than only living in a Word document nobody can query.
alter table purchase_requests add column if not exists fund_source text default '';
