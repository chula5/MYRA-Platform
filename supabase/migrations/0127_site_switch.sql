-- SITE SWITCHES — on/off settings Chloe flips from the admin, read by the
-- server without a redeploy. First one: auto_accept_applications (a sign-up
-- from the landing page becomes a member and is emailed her invitation at
-- once, instead of waiting for ACCEPT on /admin/applications).
create table if not exists public.site_switch (
  key         text primary key,
  is_on       boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.site_switch enable row level security;
insert into public.site_switch (key, is_on) values ('auto_accept_applications', false)
  on conflict (key) do nothing;
