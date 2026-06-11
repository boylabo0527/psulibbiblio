-- Migration: subjects & programs are curriculum-only, no campus.
--
-- Drops the campus/college fields on programs and the section field on
-- subjects. Those values were inherited from the subjects CSV; they're
-- not curriculum properties (the same program exists at multiple
-- campuses), so they belong only on titles (printed types) instead.

drop index if exists programs_unique;

alter table programs drop column if exists campus;
alter table programs drop column if exists college;
alter table subjects drop column if exists section;

create unique index if not exists programs_unique on programs (name);
