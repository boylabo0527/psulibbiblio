-- Migration: faculty-submitted title recommendations per subject -- lets a
-- faculty member suggest a specific title for a course they teach, which
-- then becomes visible to whoever does Market Canvassing (a concrete
-- starting point instead of canvassing blind) and to suppliers browsing
-- needs (see /api/supplier/needs), rather than only ever seeing a generic
-- "needs N more titles" gap.
--
-- status: pending (not yet acted on) -> sourced (a canvassing entry now
--   covers it, marked by canvassing/admin staff) -> declined (staff
--   decided it's not relevant/available). Purely informational -- nothing
--   else in the schema references this table by foreign key, so declining
--   or deleting a recommendation never cascades into canvassing/PR data.

create table if not exists title_recommendations (
  id bigserial primary key,
  subject_id bigint not null references subjects(id) on delete cascade,
  recommended_by text not null default '',
  title text not null,
  author text default '',
  publisher text default '',
  year text default '',
  isbn text default '',
  format_preference text default '',
  notes text default '',
  status text not null default 'pending',
  created_at timestamptz default now()
);
alter table title_recommendations drop constraint if exists title_recommendations_status_check;
alter table title_recommendations add constraint title_recommendations_status_check
  check (status in ('pending', 'sourced', 'declined'));
create index if not exists title_recommendations_subject_idx on title_recommendations(subject_id);

alter table title_recommendations enable row level security;

-- Faculty Member (seeded in 21_faculty_role.sql with zero default tab
-- access, unlike every other role) gets this one tab by default -- it's
-- the entire reason the role exists, so requiring an admin to manually
-- grant it on top of Google sign-in provisioning would leave a brand-new
-- faculty account unable to do anything at all.
insert into role_tab_permissions (role_id, tab_id, can_view, can_edit)
select r.id, 'faculty-recommendations', true, true
from roles r where r.name = 'Faculty Member'
on conflict (role_id, tab_id) do nothing;
