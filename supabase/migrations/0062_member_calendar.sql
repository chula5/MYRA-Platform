-- 0062_member_calendar.sql
-- HER CALENDAR — so MYRA knows what is coming up and can plan outfits for it.
-- Read-only. Only an event's title, time and place are kept, and only for the
-- events that look like something to dress for; she chooses which ones MYRA
-- plans. A planned event also becomes a pilot_known_event (0029), which is
-- what already drives anticipation looks.

create table if not exists public.member_calendar_connection (
  connection_id  uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.pilot_member(member_id) on delete cascade,
  provider       text not null default 'google' check (provider in ('google')),
  email          text not null,
  secret_enc     text not null,            -- refresh token, AES-GCM (email/secrets.ts)
  last_synced_at timestamptz,
  status         text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  error          text,
  created_at     timestamptz not null default now(),
  unique (member_id, provider, email)
);
alter table public.member_calendar_connection enable row level security;

create table if not exists public.member_calendar_event (
  event_id       uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.pilot_member(member_id) on delete cascade,
  connection_id  uuid references public.member_calendar_connection(connection_id) on delete cascade,
  source_id      text not null,            -- the calendar's own event id
  title          text not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  all_day        boolean not null default false,
  location       text,
  occasion       text,                     -- MYRA's read: dinner_drinks | event | travel | work_elevated | casual_day
  status         text not null default 'suggested' check (status in ('suggested', 'planning', 'ignored')),
  known_event_id uuid references public.pilot_known_event(event_id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (member_id, source_id)
);
alter table public.member_calendar_event enable row level security;
create index if not exists idx_member_calendar_event_upcoming on public.member_calendar_event (member_id, starts_at);
