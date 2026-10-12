-- 0099: EVENTS — what she is looking for, and the pieces MYRA picked for it.
-- Idempotent; applied with `npm run migrate`.
--
-- Chloe asked (2026-10-12) for the Events room to refresh itself weekly after
-- the Monday Brand Watch upload: two or three options per upcoming event,
-- from the brands she likes or their neighbours, in her size and her price
-- band, each already styled three ways and checked — and a note (email + the
-- app) when new options land. The brief is hers in her own words ("a cocktail
-- dress, probably long"); Chloe can set it for her too.

-- The brief on the event itself. A calendar task (0077) carries its own brief;
-- an event Chloe or she added by hand had nowhere to say what it needs.
alter table public.pilot_known_event add column if not exists brief text;
alter table public.pilot_known_event add column if not exists updated_at timestamptz not null default now();

-- The ways composed for an event hero are kept in the same memory as every
-- other way (styled_way); they just say where they came from.
alter table public.styled_way drop constraint if exists styled_way_source_check;
alter table public.styled_way add constraint styled_way_source_check
  check (source in ('tap','warmup','mcp','mirror','event'));

-- What MYRA picked for an event: one row per hero piece. `shown` is the gate:
-- the weekly cron shows at once (it only picks pieces whose outfits passed the
-- check); a trial run holds its picks for Chloe to look at first.
create table if not exists public.event_pick (
  event_pick_id   uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.pilot_member(member_id) on delete cascade,
  known_event_id  uuid not null references public.pilot_known_event(event_id) on delete cascade,
  item_id         text not null,
  why             text not null default '',
  -- ISO week the pick was made in ("2026-W42"): the weekly refresh adds to a week, never twice.
  week_key        text not null,
  shown           boolean not null default true,
  picked_at       timestamptz not null default now(),
  -- When she was told about it (email / app note). Null = not yet.
  told_at         timestamptz,
  -- She said not this one.
  dismissed_at    timestamptz,
  unique (known_event_id, item_id)
);
alter table public.event_pick enable row level security;
create index if not exists idx_event_pick_member on public.event_pick (member_id, picked_at desc);
create index if not exists idx_event_pick_event on public.event_pick (known_event_id) where dismissed_at is null;

-- The app note for new options.
alter table public.pilot_notification drop constraint if exists pilot_notification_kind_check;
alter table public.pilot_notification add constraint pilot_notification_kind_check
  check (kind in ('looks_ready', 'note', 'event_picks'));
