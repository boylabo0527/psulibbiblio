-- Migration: flags a title recommendation that came in through the public
-- "Suggest a Title" form (no sign-in required) rather than an
-- authenticated faculty/staff account -- lets Market Canvassing staff see
-- at a glance that recommended_by is free-typed text from an anonymous
-- visitor, not a verified PSU account, when reviewing the pending queue.
alter table title_recommendations add column if not exists submitted_publicly boolean not null default false;
