-- Migration: captures which PSU campus a title suggestion is for. A course
-- (subject) is shared across every campus that offers its program -- the
-- same curriculum applies everywhere -- so which campus's shortage a
-- suggestion actually addresses can't be inferred from subject_id alone.
-- Asked on the public "Suggest a Title" form since a visitor could be
-- submitting from (or on behalf of) any PSU campus.
alter table title_recommendations add column if not exists campus text default '';
