-- Migration: scope printed titles to a campus.
--
-- Adds an optional titles.campus column. The upload UI populates it only
-- for Printed Books / Printed Journals uploads. eBooks and Online Journals
-- leave it empty (they're available to all campuses).
--
-- When loading a program's bibliography, printed titles whose campus is
-- empty or matches the program's campus are included; printed titles from
-- other campuses are filtered out. Non-printed titles are always included.

alter table titles add column if not exists campus text default '';
create index if not exists titles_campus_idx on titles (campus);
