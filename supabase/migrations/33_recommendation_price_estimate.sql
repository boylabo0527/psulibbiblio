-- Migration: faculty can suggest a ballpark price alongside a title
-- recommendation -- gives Procurement Analysis's cost estimate something
-- to go on even before the title has been through Market Canvassing.
alter table title_recommendations add column if not exists price_estimate numeric;
