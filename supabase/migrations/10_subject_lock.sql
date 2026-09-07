-- Migration: per-subject lock so a librarian's curated title list survives
-- future Match runs untouched. Manually-added titles already survive
-- (assignments.manual=1 rows are never deleted by a match run), but there
-- was no way to also protect a subject's remaining auto-matched titles, or
-- to stop a deliberately-removed auto-match from silently reappearing the
-- next time Match runs. Locking a subject skips it entirely during
-- matching -- its assignment list is left exactly as-is.

alter table subjects add column if not exists locked boolean not null default false;

-- DEPRECATED as of 44_promote_locked_subject_assignments.sql: the app no
-- longer skips a subject during Match runs just because it's locked, since
-- that also blocked newly-uploaded books from ever being matched into it.
-- Locking is per-title now (assignments.manual=1). This column is left in
-- place for old data but is no longer read or written by the app.
