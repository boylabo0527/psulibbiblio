-- Lets an admin override what a course's automatic matching searches for,
-- instead of always deriving it from course_title/description. Exists
-- because that derivation can go wrong in ways an admin can see instantly
-- but the algorithm can't reliably detect (see lib/matcher.ts's
-- subjectMustQuery/stripAudienceQualifier for one such case already
-- handled generically) -- this is the manual escape hatch for whatever
-- pattern comes up next, without needing a code change each time.
-- Empty/unset (the default) means "use the normal title/description-based
-- matching, unchanged."
alter table subjects add column if not exists match_keyword text default '';
