-- 0035: Price-aware brand similarity — price as a second explicit axis.
-- Run AFTER 0034 in the Supabase SQL editor (idempotent).
--
-- The 34-dim aesthetic vector stays pure: price is NEVER a vector dimension.
-- brand_similarity(A,B) = aesthetic_cosine × price_proximity, where
-- price_proximity = exp(-|price_position_A − price_position_B| / k) and
-- price_position = ln(median price of the brand's core category).
--
-- median_price_by_category: { dresses: { median, count }, tops: {…}, … }
-- core_category: the category with the most items for this brand.
-- Reference brands get price_position from a manually entered typical price.

alter table public.brand add column if not exists median_price_overall numeric;
alter table public.brand add column if not exists median_price_by_category jsonb;
alter table public.brand add column if not exists core_category text;
alter table public.brand add column if not exists price_position numeric;

-- Singleton config (pipeline_config pattern): positioning-band boundaries in
-- GBP and the price-proximity decay constant k, both editable in the
-- Taste Inspector.
create table if not exists public.brand_affinity_config (
  id int primary key check (id = 1),
  band_bounds jsonb not null default '[150, 350, 700, 1200, 2500]',
  price_k numeric not null default 1.8,
  updated_at timestamptz not null default now()
);
insert into public.brand_affinity_config (id) values (1) on conflict (id) do nothing;

alter table public.brand_affinity_config enable row level security;
