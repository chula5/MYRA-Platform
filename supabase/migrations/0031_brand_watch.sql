-- 0031: Brand Watch — in-app brand scanner + weekly new-drop discovery.
-- Run AFTER 0030, manually in the Supabase SQL editor (idempotent).
--
-- watched_brand: the watchlist (one row per Shopify storefront).
-- brand_watch_seen: every Shopify product id already shown, per watched brand —
--   the diff against this is what makes something "new".
-- item.discovery_*: provenance for items the watcher queues, so /admin/brand-watch
--   can list exactly its own queue (draft + discovery_source = 'brand_watch').

create table if not exists public.watched_brand (
  watched_brand_id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.brand(brand_id) on delete set null,
  name text not null,
  base_url text not null unique,
  active boolean not null default true,
  min_score int not null default 5,
  last_checked_at timestamptz,
  last_new_count int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_watch_seen (
  watched_brand_id uuid not null references public.watched_brand(watched_brand_id) on delete cascade,
  shopify_product_id text not null,
  seen_at timestamptz not null default now(),
  primary key (watched_brand_id, shopify_product_id)
);

alter table public.item add column if not exists discovery_source text;
alter table public.item add column if not exists discovery_score numeric;
alter table public.item add column if not exists discovered_at timestamptz;

create index if not exists idx_item_discovery_queue
  on public.item (discovered_at desc)
  where discovery_source = 'brand_watch' and status = 'draft';

alter table public.watched_brand enable row level security;
alter table public.brand_watch_seen enable row level security;
-- No anon policies: service-role only, same as the other admin-side tables.
