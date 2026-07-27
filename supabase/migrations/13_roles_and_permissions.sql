-- Migration: admin-configurable roles and per-tab view/edit permissions.
--
-- roles: named roles an admin can create. is_admin=true is special --
--   always full access to everything, including managing roles/users
--   themselves. There must always be at least one admin role (the seed
--   below), so the app can never lock itself out.
-- role_tab_permissions: for each (role, tab), whether that role can see
--   the tab at all (can_view) and whether it can perform mutating
--   actions within it (can_edit). Admin rows are not stored here --
--   is_admin roles are always full-access, checked in application code.
-- user_roles: maps a signed-in user's email (already created in Supabase
--   Auth -> Users, per the existing no-signup flow) to exactly one role.

create table if not exists roles (
  id bigserial primary key,
  name text not null unique,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists role_tab_permissions (
  role_id bigint not null references roles(id) on delete cascade,
  tab_id text not null,
  can_view boolean not null default false,
  can_edit boolean not null default false,
  primary key (role_id, tab_id)
);

create table if not exists user_roles (
  email text primary key,
  role_id bigint not null references roles(id) on delete cascade,
  created_at timestamptz default now()
);

insert into roles (name, is_admin) values
  ('Admin', true),
  ('Librarian', false),
  ('Library Staff', false),
  ('Supplier', false)
on conflict (name) do nothing;

-- Bootstrap the admin account so the app can never lock itself out of
-- role/permission management.
insert into user_roles (email, role_id)
select 'cbnalica@gmail.com', id from roles where name = 'Admin'
on conflict (email) do update set role_id = excluded.role_id;

-- Default permissions -- all editable later from the User Management tab.
-- Librarian: full access to day-to-day tabs, same as staff, but also the
-- Activity Log's revert action (staff can view the log, not revert).
insert into role_tab_permissions (role_id, tab_id, can_view, can_edit)
select r.id, t.tab_id, true, true
from roles r, (values
  ('upload'), ('match'), ('programs'), ('campus-validation'),
  ('procurement'), ('canvassing'), ('purchase-request'), ('activity')
) as t(tab_id)
where r.name = 'Librarian'
on conflict (role_id, tab_id) do nothing;

-- Library Staff: same day-to-day tabs, but view-only on Activity Log
-- (can see what happened, can't revert an upload or delete history).
insert into role_tab_permissions (role_id, tab_id, can_view, can_edit)
select r.id, t.tab_id, true, true
from roles r, (values
  ('upload'), ('match'), ('programs'), ('campus-validation'),
  ('procurement'), ('canvassing'), ('purchase-request')
) as t(tab_id)
where r.name = 'Library Staff'
on conflict (role_id, tab_id) do nothing;

insert into role_tab_permissions (role_id, tab_id, can_view, can_edit)
select r.id, 'activity', true, false
from roles r where r.name = 'Library Staff'
on conflict (role_id, tab_id) do nothing;

-- Supplier: only the dedicated read-only Supplier View tab.
insert into role_tab_permissions (role_id, tab_id, can_view, can_edit)
select r.id, 'supplier-view', true, false
from roles r where r.name = 'Supplier'
on conflict (role_id, tab_id) do nothing;

alter table roles enable row level security;
alter table role_tab_permissions enable row level security;
alter table user_roles enable row level security;
