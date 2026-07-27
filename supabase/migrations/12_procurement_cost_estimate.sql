-- Migration: per-program and per-subject cost-per-title estimates, so
-- Procurement Analysis can show an estimated total cost to close each
-- subject's gap. A subject's own estimate wins if set; otherwise its
-- program's estimate is used. Neither is required -- subjects with no
-- estimate anywhere just show no cost figure rather than a guessed one.

alter table programs add column if not exists cost_per_title numeric;
alter table subjects add column if not exists cost_per_title numeric;
