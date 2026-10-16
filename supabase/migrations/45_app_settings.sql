-- Single-row table of site-wide toggles an admin can flip at runtime,
-- starting with whether the "Sign in with Google" option is offered on the
-- login screen at all (some deployments may want email/password only).
create table if not exists app_settings (
  id int primary key default 1 check (id = 1),
  google_login_enabled boolean not null default true
);
insert into app_settings (id) values (1) on conflict (id) do nothing;
