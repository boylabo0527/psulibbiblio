-- Migration: "Faculty Member" role, for staff signing in via Google SSO
-- (see app/auth/callback and app/api/auth/provision-google) -- granted
-- automatically on first Google sign-in from the university's domain, same
-- as any other role otherwise assigned by hand from User Management.
--
-- No default tab permissions are seeded: a brand-new Faculty account starts
-- with zero access, same as any unassigned email today, until an admin
-- grants specific tabs from the User Management tab.

insert into roles (name, is_admin) values
  ('Faculty Member', false)
on conflict (name) do nothing;
