-- taste_log: append-only record of every item save, for building a taste profile.
-- One row per create/update event — denormalised snapshot so aggregation is cheap.

create table if not exists public.taste_log (
  log_id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.item(item_id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated')),

  -- denormalised identity at time of save
  brand_id uuid references public.brand(brand_id) on delete set null,
  brand_name text,
  brand_price_tier int,
  item_type text,

  -- taste-relevant attributes
  colour_family text,
  material_category text,
  fit int,
  length int,
  structure int,
  shoulder int,
  waist_definition int,
  leg_opening int,
  surface int,
  colour_depth int,
  pattern int,
  sheen int,
  material_weight int,
  material_formality int,

  admin_notes text,

  logged_at timestamptz not null default now()
);

create index if not exists taste_log_logged_at_idx on public.taste_log (logged_at desc);
create index if not exists taste_log_brand_id_idx on public.taste_log (brand_id);
create index if not exists taste_log_item_type_idx on public.taste_log (item_type);
