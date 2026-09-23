-- 0068: her MYRA link for an assistant (Claude, ChatGPT).
-- Run manually in the Supabase SQL editor (idempotent).
--
-- The link itself is a signed token, so it needs no storage to WORK. It needs
-- storage to be answerable: whether she has one, when she made it, when it was
-- last used, and — the important one — to be turned off. Only the hash is
-- kept: the link is hers, and MYRA does not need a copy of it.
create table if not exists public.member_assistant_link (
  member_id    uuid primary key references public.pilot_member(member_id) on delete cascade,
  token_hash   text not null,
  issued_at    timestamptz not null default now(),
  last_used_at timestamptz,
  uses         int not null default 0
);
alter table public.member_assistant_link enable row level security;
