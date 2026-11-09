-- SAVED SEARCHES + WAIT FOR SALE (2026-11-01).
--
-- Chloe: "make a saved search for a pair of trousers in the morning and then
-- log back on in the evening, and there will be some options for me there" —
-- and save a piece to wait for it to go on sale, told when the price drops.
--
-- saved_search holds her words (and any narrowing she had on). The hourly cron
-- (api/cron/saved-searches) re-runs them through lib/member-search with
-- `since` = last_run_at and keeps every new answer as a saved_search_hit.
-- Unseen hits are the N NEW on her chip; opening the search marks them seen.
-- At most one note a day (last_pushed_at) — new finds are quiet.

create table if not exists public.saved_search (
  saved_search_id uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.pilot_member(member_id) on delete cascade,
  query           text not null,
  -- BrowseFilters she had on when she saved it (brands, colours, types, sizes).
  filters         jsonb not null default '{}'::jsonb,
  -- What MYRA read, for the chip: "NAVY · CAMI".
  label           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  last_run_at     timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_pushed_at  timestamptz,
  unique (member_id, query)
);
create index if not exists saved_search_member_idx on public.saved_search (member_id, created_at desc);
create index if not exists saved_search_active_idx on public.saved_search (active, last_run_at) where active;
alter table public.saved_search enable row level security;

create table if not exists public.saved_search_hit (
  saved_search_id uuid not null references public.saved_search(saved_search_id) on delete cascade,
  item_id         uuid not null references public.item(item_id) on delete cascade,
  found_at        timestamptz not null default now(),
  -- null = new to her. Answers there when she saved are seeded as seen.
  seen_at         timestamptz,
  primary key (saved_search_id, item_id)
);
-- Item deletes walk every item_id FK (see 0096).
create index if not exists saved_search_hit_item_id_idx on public.saved_search_hit (item_id);
create index if not exists saved_search_hit_unseen_idx on public.saved_search_hit (saved_search_id) where seen_at is null;
alter table public.saved_search_hit enable row level security;

-- WAIT FOR SALE: a bell on a saved piece. The price is frozen when she rings it;
-- a drop of 5% (and £3) under both that and the lowest seen tells her at once.
alter table public.member_saved_item
  add column if not exists price_watch      boolean not null default false,
  add column if not exists price_at_watch   numeric,
  add column if not exists lowest_seen      numeric,
  add column if not exists price_dropped_at timestamptz;
create index if not exists member_saved_item_price_watch_idx on public.member_saved_item (item_id) where price_watch;

-- Every price MYRA reads for a piece, when it changes — the sale's evidence.
create table if not exists public.item_price_history (
  item_id       uuid not null references public.item(item_id) on delete cascade,
  price_gbp     numeric not null,
  -- The shop's own "was" price (Shopify compare_at_price, a struck-through price).
  was_price_gbp numeric,
  source        text,
  seen_at       timestamptz not null default now()
);
create index if not exists item_price_history_item_id_idx on public.item_price_history (item_id, seen_at desc);
alter table public.item_price_history enable row level security;

alter table public.item add column if not exists was_price_gbp numeric;

alter table public.pilot_notification drop constraint if exists pilot_notification_kind_check;
alter table public.pilot_notification add constraint pilot_notification_kind_check
  check (kind in ('looks_ready', 'note', 'event_picks', 'share', 'new_in', 'saved_search', 'price_drop'));
