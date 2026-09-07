-- Subject-level locking (10_subject_lock.sql) skipped a locked subject
-- entirely during Match runs -- which also meant Match could never search
-- for or add newly-uploaded books to that course anymore, defeating the
-- point of re-running Match after a catalog update. The app now locks
-- individual title matches instead (assignments.manual=1, already
-- protected from deletion by every Match run -- see app/api/match/run),
-- leaving the subject itself open so new candidates keep getting found.
--
-- Before that change ships, promote every assignment under a currently
-- locked subject to manual=1, so whatever a librarian curated under the
-- old whole-subject lock survives the transition instead of becoming
-- fair game for the very next Match run.

update assignments a
set manual = 1
from subjects s
where a.subject_id = s.id
  and s.locked = true
  and a.manual = 0;
