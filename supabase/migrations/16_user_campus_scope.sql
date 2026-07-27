-- Migration: lets the admin restrict specific users to one or more
-- campuses. A restricted user's dropdowns and data (Programs & Export,
-- Campus Validation, Procurement Analysis, Supplier View, Match) are
-- limited to programs offered at those campuses.
--
-- A user with NO rows here is unrestricted (sees everything) -- this is
-- today's behavior, so every existing user is unaffected until an admin
-- explicitly assigns a campus scope to their email. This is independent
-- of role: two users with the same role can be scoped to different
-- campuses (or not scoped at all).
create table if not exists user_campuses (
  email      text not null,
  campus_id  bigint not null references campuses(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (email, campus_id)
);
create index if not exists user_campuses_email_idx on user_campuses (email);
