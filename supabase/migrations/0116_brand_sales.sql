-- BLACK FRIDAY — brand sales, found by MYRA, told to the members who shop them
-- (2026-11-06).
--
-- Chloe: "plan for the upcoming black friday sales — how can we let our users
-- know of each of the sales and then recommend them some items? Maybe gaps in
-- their wardrobe … some black fridays start earlier like 2 weeks before."
--
-- The sale sweep (api/cron/sales, lib/sales) reads every watched Shopify
-- brand's catalogue for today's price and the shop's own was-price, and keeps
-- one row per brand: on sale or not, since when, how many pieces, how deep.
-- A member hears about a brand's sale once (sale_note), at most three a day.

create table if not exists public.brand_sale (
  brand_id       uuid primary key references public.brand(brand_id) on delete cascade,
  -- On sale now: enough of the catalogue marked down (lib/sales/detect).
  active         boolean not null default false,
  started_at     timestamptz,
  ended_at       timestamptz,
  last_swept_at  timestamptz,
  on_sale_count  integer not null default 0,
  total_count    integer not null default 0,
  max_off_pct    integer,
  median_off_pct integer,
  -- Chloe's switch: a paused sale is never shown or told, whatever the sweep reads.
  paused         boolean not null default false,
  updated_at     timestamptz not null default now()
);
create index if not exists brand_sale_active_idx on public.brand_sale (active) where active;
alter table public.brand_sale enable row level security;

-- Which brand sales each member has been told of: once per sale, ever.
create table if not exists public.sale_note (
  member_id  uuid not null references public.pilot_member(member_id) on delete cascade,
  -- brand_id null = the Black Friday heads-up, before any sale.
  brand_id   uuid references public.brand(brand_id) on delete cascade,
  sale_started_at timestamptz,
  kind       text not null check (kind in ('heads_up', 'brand_sale', 'roundup')),
  told_at    timestamptz not null default now()
);
create unique index if not exists sale_note_once_idx
  on public.sale_note (member_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(sale_started_at, 'epoch'::timestamptz), kind);
create index if not exists sale_note_member_idx on public.sale_note (member_id, told_at desc);
alter table public.sale_note enable row level security;

alter table public.pilot_notification drop constraint if exists pilot_notification_kind_check;
alter table public.pilot_notification add constraint pilot_notification_kind_check
  check (kind in ('looks_ready', 'note', 'event_picks', 'share', 'new_in', 'saved_search', 'price_drop', 'sale'));
