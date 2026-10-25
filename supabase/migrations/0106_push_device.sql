-- 0106: PHONE PUSH — the iPhones a member has said yes to notifications on.
-- Idempotent; applied with `npm run migrate`.
--
-- Chloe asked (2026-10-24) for the TestFlight app to tell members when their
-- brands have new pieces (the Monday new-in push), not only an unread count.
-- The app asks iOS for permission, iOS hands back a device token, and the app
-- gives it to /me (registerPushDevice). The server sends to Apple directly
-- (lib/push/apns.ts) — no Firebase, no third party.
--
-- One row per token. A token moves to whoever signs in on that phone last;
-- Apple says when a token is dead (410 Unregistered) and the row is disabled.
-- `environment` is learned, not declared: Xcode debug builds hold sandbox
-- tokens, TestFlight and the App Store production ones, and the sender tries
-- the one on record first.

create table if not exists public.push_device (
  device_token  text primary key,
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  auth_user_id  uuid,
  platform      text not null default 'ios' check (platform in ('ios')),
  environment   text not null default 'production' check (environment in ('production', 'sandbox')),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_sent_at  timestamptz,
  disabled_at   timestamptz,
  last_error    text
);
create index if not exists idx_push_device_member on public.push_device (member_id) where disabled_at is null;
alter table public.push_device enable row level security;

-- The Monday note: new pieces from her brands, in her size.
alter table public.pilot_notification drop constraint if exists pilot_notification_kind_check;
alter table public.pilot_notification add constraint pilot_notification_kind_check
  check (kind in ('looks_ready', 'note', 'event_picks', 'share', 'new_in'));

-- Service-role only, as every other pilot table: the app registers through a
-- server action that resolves the signed-in member, never directly.
