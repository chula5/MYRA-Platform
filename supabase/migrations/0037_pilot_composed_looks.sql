-- 0037: Private Stylist — composed looks + swap/accept learning.
-- Run AFTER 0036, manually in the Supabase SQL editor (idempotent).
--
-- The stylist can now COMPOSE looks for a member from the item library
-- (brand-affinity + brand-family weighted). Chloe reviews each composition:
-- approving it or swapping items out. Every decision lands here so the
-- composer learns, per member, which items get swapped away and which brand
-- pairings survive review.

create table if not exists public.pilot_look_feedback (
  feedback_id uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  delivery_id uuid references public.pilot_delivery(delivery_id) on delete set null,
  look_id     uuid references public.pilot_look(look_id) on delete set null,
  action      text not null check (action in ('accept', 'swap')),
  slot        text,
  item_out    uuid,           -- swapped away (no FK: survives item deletion)
  item_in     uuid,           -- swapped in / accepted
  brand_out   uuid,
  brand_in    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_plf_member on public.pilot_look_feedback (member_id, created_at desc);
alter table public.pilot_look_feedback enable row level security;
-- No anon policies: service-role only, same as the other pilot tables.

-- Chloe's approval of a composed look (separate from the member's yes/no response)
alter table public.pilot_look add column if not exists approved_at timestamptz;
