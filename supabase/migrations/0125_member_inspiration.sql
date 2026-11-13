-- 0125 · INSPIRATION TO OUTFIT — a member's picture of a look, styled for her.
--
-- On her Looks page she drops a picture of an outfit — a runway exit, a street
-- shot, a saved post — and MYRA styles outfits around it from pieces in her
-- size and price range (lib/member-inspiration, the same reading and matching
-- Outfit Review's look projects use). The outfits are kept as a delivery of
-- hers (pilot_delivery + pilot_look, request_text 'Inspiration — …'), so her
-- Looks page shows them like any other; this table holds the picture, how MYRA
-- read it, and where the work stands while it composes in the background.
--
-- Service-role only, like every member table: RLS on, no policies.

create table if not exists public.member_inspiration (
  inspiration_id  uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.pilot_member(member_id) on delete cascade,
  image_url       text not null,
  title           text not null,
  -- The read: pieces, palette, summary, the asks, and the matches once planned.
  inspiration     jsonb not null,
  status          text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts        int not null default 0,
  error           text,
  looks_count     int not null default 0,
  delivery_id     uuid references public.pilot_delivery(delivery_id) on delete set null,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  heartbeat_at    timestamptz,
  finished_at     timestamptz
);
alter table public.member_inspiration enable row level security;
create index if not exists member_inspiration_member_idx on public.member_inspiration (member_id, created_at desc);
create index if not exists member_inspiration_queue_idx on public.member_inspiration (status, created_at);
