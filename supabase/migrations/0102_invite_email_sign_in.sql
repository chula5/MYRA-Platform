-- 0102: EMAIL + CODE SIGN-IN — the email Chloe gives a member before she has a login.
-- Idempotent; applied with `npm run migrate`.
--
-- Chloe asked (2026-10-17) for an email-first door in the iPhone app: she adds
-- a member with her email; the member types that email on the door; if it is
-- on the list she is sent a one-time code, and on her first sign-in she makes
-- a password. The invite link (/join/…) and email + password keep working.
--
-- pilot_member.email (0100) is the email her LOGIN uses, copied for sharing.
-- invite_email is the one Chloe writes down BEFORE there is a login. They
-- usually end up the same; they are kept apart so a member who made her login
-- with a different address is still found by either.

alter table public.pilot_member add column if not exists invite_email text;
create index if not exists idx_pilot_member_invite_email
  on public.pilot_member (lower(invite_email)) where invite_email is not null;

comment on column public.pilot_member.invite_email is
  'The email Chloe gave this member for the door (email + code sign-in). Lower-cased on save.';

-- Who an email belongs to at the door, if anyone. One row or none: the member
-- whose login already uses this email, else the member Chloe wrote it down
-- for. Reads auth.users, so it is SECURITY DEFINER and only the service role
-- may call it (the server action behind the door; never the browser).
create or replace function public.member_for_sign_in(p_email text)
returns table (
  member_id    uuid,
  name         text,
  auth_user_id uuid,
  user_id      uuid,
  has_password boolean
)
language sql
security definer
set search_path = public, auth
as $$
  with e as (
    select lower(trim(p_email)) as email
  ),
  u as (
    select au.id, (coalesce(au.encrypted_password, '') <> '') as has_password
      from auth.users au, e
     where lower(au.email) = e.email
       and au.deleted_at is null
     order by au.created_at
     limit 1
  )
  select m.member_id, m.name, m.auth_user_id, u.id as user_id, coalesce(u.has_password, false) as has_password
    from public.pilot_member m
    cross join e
    left join u on true
   where coalesce(m.is_synthetic, false) = false
     and (
       (m.auth_user_id is not null and m.auth_user_id = u.id)
       or lower(m.invite_email) = e.email
       or lower(m.email) = e.email
     )
   order by (m.auth_user_id = u.id) desc nulls last, m.created_at
   limit 1;
$$;

revoke all on function public.member_for_sign_in(text) from public;
revoke all on function public.member_for_sign_in(text) from anon;
revoke all on function public.member_for_sign_in(text) from authenticated;
