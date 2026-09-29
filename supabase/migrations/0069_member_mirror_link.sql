-- 0069: the MYRA Mirror extension, as she sees it from her YOU page.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- The extension holds a signed member token and needs nothing stored to WORK.
-- This row is so the YOU page can answer "is it connected, in which browser,
-- when did it last check in?" — written each time the extension asks
-- /api/mirror/me for who it is (on connect, and every time the popup opens).
create table if not exists public.member_mirror_link (
  member_id    uuid primary key references public.pilot_member(member_id) on delete cascade,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  browser      text,
  uses         int not null default 0
);
alter table public.member_mirror_link enable row level security;
