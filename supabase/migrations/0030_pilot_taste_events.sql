-- 0030_pilot_taste_events.sql
-- Vector learning for the PRIVATE STYLIST pilot. Run AFTER 0029.
--
-- Every signal (yes / no / save / click-out / purchase) becomes a taste event
-- carrying the look's room mix AND its 34-dim vector, so the pilot collects
-- the same shape of data the main app's taste graph runs on. Room weights and
-- the member taste vector are both recomputed deterministically by replaying
-- these events — nothing here touches the live taste tables.

create table if not exists public.pilot_taste_event (
  event_id      uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  delivery_id   uuid references public.pilot_delivery(delivery_id) on delete set null,
  look_id       uuid references public.pilot_look(look_id) on delete set null,
  event_type    text not null check (event_type in ('yes', 'no', 'save', 'click_out', 'purchase')),
  -- purchase 7 / save 5 / click_out 4 / yes 3 / no -2 — main-app hierarchy
  signal_weight int not null,
  -- snapshots at event time, so replay is stable even if the look is edited
  room_mix      jsonb not null default '{}'::jsonb,
  taste_vector  jsonb,                -- 34-dim array, n5 [0,1] scale
  is_synthetic  boolean not null default false,
  created_at    timestamptz not null default now()
);
alter table public.pilot_taste_event enable row level security;

create index if not exists idx_pilot_taste_event_member
  on public.pilot_taste_event(member_id, created_at);

-- Accumulated 34-dim taste vector per member (Σ signal_weight × look vector).
-- Direction is what matters — cosine against the room centroids gives an
-- independent read on her room affinity to cross-check the room weights.
alter table public.pilot_member add column if not exists taste_vector jsonb;

-- Each look snapshots its own vector when saved (room-centroid blend).
alter table public.pilot_look add column if not exists taste_vector jsonb;

-- No policies on purpose — service-role only, same as 0029.
