-- 0077: EVENTS — what she is dressing for, and what she is looking for.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Her calendar (0062) reads the dressable events out of Google, read-only, and
-- she can ask MYRA to plan an outfit for one of them. This is the other half:
-- the brief she sets for an event — "find a black dress" — and, the question a
-- brief cannot answer, where the outfit may come from: her own wardrobe, new
-- pieces, or both. She answers that every time a task is set; nothing is
-- assumed on her behalf.
--
-- A task hangs off a calendar event when there is one, and stands on its own
-- when she adds the occasion herself. Either way it becomes a pilot_known_event
-- (0029) — the thing the studio already plans anticipation around — so setting
-- a task and asking the calendar to "plan an outfit" put the same event in the
-- same place. Removing the task takes that back.
--
-- event_label and event_date are copied from the calendar event (or typed by
-- her) rather than joined at read time, so a task outlives the event being
-- dropped by a later sync.
--
-- RLS on with no policies, like the calendar tables: only the service-role
-- admin client can touch this. Nothing here is reachable from the public site.

create table if not exists public.member_styling_task (
  task_id           uuid primary key default gen_random_uuid(),
  member_id         uuid not null references public.pilot_member(member_id) on delete cascade,
  -- The calendar event this was set for, when there was one.
  calendar_event_id uuid references public.member_calendar_event(event_id) on delete set null,
  -- The known event the studio plans around (0029). Null until it is linked.
  known_event_id    uuid references public.pilot_known_event(event_id) on delete set null,
  event_label       text not null,          -- "Wedding", "Greece holiday"
  event_date        text not null,          -- "2026-09-14" (month precision allowed, as 0029)
  brief             text not null,          -- "find a black dress"
  -- Where the outfit may come from: her wardrobe, new pieces, or both.
  source            text not null default 'both' check (source in ('wardrobe', 'new', 'both')),
  status            text not null default 'planned' check (status in ('planned', 'styled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.member_styling_task enable row level security;
create index if not exists idx_member_styling_task_member on public.member_styling_task (member_id, event_date);
