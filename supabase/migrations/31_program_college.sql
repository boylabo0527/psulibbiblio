-- Migration: programs gain a "college" classification (e.g. "College of
-- Nursing"), so faculty browsing canvassed titles to recommend can jump
-- straight to their own college instead of scanning every program's
-- titles. Unlike the campus/college columns dropped in migration 04 (those
-- meant "where this program instance is physically offered," which
-- belongs on titles, not the curriculum-only programs table), this is a
-- genuine academic-organization property of the program itself, invariant
-- across whichever campuses offer it -- so it belongs here.
alter table programs add column if not exists college text default '';
create index if not exists programs_college_idx on programs (college);
