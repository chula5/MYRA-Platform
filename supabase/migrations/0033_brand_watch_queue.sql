-- 0033: Brand Watch queue moves OUT of the item table.
-- Run AFTER 0032, manually in the Supabase SQL editor (idempotent).
--
-- Scanned pieces used to be inserted as draft items and a skip archived them —
-- which left skipped pieces sitting in the item library. Now the scan queues
-- into brand_watch_queue; only KEEP creates an item (as ready). Skips stay in
-- this table as decisions (dedupe + keep/skip learning) and never touch item.
--
-- Backfill: existing brand-watch drafts move here as 'queued', archived skips
-- as 'skipped', kept pieces get a 'kept' decision row (the item row remains).
-- Draft + archived brand-watch rows are then deleted from item.

create table if not exists public.brand_watch_queue (
  queue_id uuid primary key default gen_random_uuid(),
  watched_brand_id uuid references public.watched_brand(watched_brand_id) on delete set null,
  brand_id uuid references public.brand(brand_id) on delete set null,
  shopify_product_id text,
  shopify_handle text,
  product_name text not null,
  retailer_url text not null,
  image_url text not null default '',
  price text,
  currency text,
  price_gbp numeric,
  item_type text,
  colour_family text,
  material_category text,
  material_primary text,
  stock_status text,
  stock_sizes text[],
  discovery_score numeric,
  admin_notes text,
  status text not null default 'queued' check (status in ('queued', 'kept', 'skipped')),
  decided_at timestamptz,
  item_id uuid references public.item(item_id) on delete set null,
  discovered_at timestamptz not null default now()
);

create index if not exists idx_bwq_status on public.brand_watch_queue (status, discovered_at desc);
create index if not exists idx_bwq_brand on public.brand_watch_queue (brand_id);
create index if not exists idx_bwq_pid on public.brand_watch_queue (shopify_product_id);

alter table public.brand_watch_queue enable row level security;
-- No anon policies: service-role only, same as watched_brand.

-- ---------------------------------------------------------------- backfill

insert into public.brand_watch_queue (
  brand_id, shopify_product_id, shopify_handle, product_name, retailer_url,
  image_url, price, currency, price_gbp, item_type, colour_family,
  material_category, material_primary, stock_status, stock_sizes,
  discovery_score, admin_notes, status, decided_at, item_id, discovered_at
)
select
  i.brand_id, i.shopify_product_id, i.shopify_handle, i.product_name, i.retailer_url,
  coalesce(i.image_url, ''), i.price, i.currency, i.price_gbp, i.item_type, i.colour_family,
  i.material_category, i.material_primary, i.stock_status, i.stock_sizes,
  i.discovery_score, i.admin_notes,
  case i.status when 'draft' then 'queued' when 'archived' then 'skipped' else 'kept' end,
  case when i.status in ('draft') then null else now() end,
  case when i.status in ('draft', 'archived') then null else i.item_id end,
  coalesce(i.discovered_at, i.created_at)
from public.item i
where i.discovery_source = 'brand_watch'
  and not exists (
    select 1 from public.brand_watch_queue q
    where q.shopify_product_id = i.shopify_product_id and q.brand_id = i.brand_id
  );

-- Skipped/queued brand-watch rows leave the item table. Anything referenced by
-- an outfit stays put (shouldn't happen for drafts, but never break an outfit).
delete from public.item i
where i.discovery_source = 'brand_watch'
  and i.status in ('draft', 'archived')
  and not exists (select 1 from public.outfit_item oi where oi.item_id = i.item_id);
