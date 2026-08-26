-- Migration: captures whether the person suggesting a title is Faculty,
-- Student, Staff, or Other -- asked on the public "Suggest a Title" form
-- (no sign-in), where recommended_by is otherwise just free-typed text
-- with no other way to tell who's submitting.
alter table title_recommendations add column if not exists submitter_role text default '';
