-- 0036: BRAND CODES — authored, industry-style brand identity dimensions.
-- Run AFTER 0035 in the Supabase SQL editor (idempotent).
--
-- Codes are scored manually (1-5, decimals allowed) and are NEVER recomputed
-- from items — no job may write brand_codes except the admin UI. Item-level
-- 34-dim scoring and the computed item centroid keep their weekly recompute;
-- the centroid stays in use for outfit composition, stylist masks, and the
-- weekly code-drift check.

create table if not exists public.brand_code_dimension (
  dimension_key text primary key,
  label text not null,
  sort int not null,
  anchors jsonb not null -- {"1": "...", ..., "5": "..."}
);

insert into public.brand_code_dimension (dimension_key, label, sort, anchors) values
  ('price_positioning',  'PRICE POSITIONING',    1, '{"1":"premium high street","2":"affordable luxury","3":"contemporary luxury","4":"legacy luxury","5":"haute couture"}'),
  ('era_orientation',    'ERA ORIENTATION',      2, '{"1":"trend-reactive","2":"contemporary","3":"modern-classic","4":"heritage-informed","5":"legacy/archival"}'),
  ('aesthetic_output',   'AESTHETIC OUTPUT',     3, '{"1":"extremely minimal","2":"restrained","3":"balanced","4":"expressive","5":"highly expressive"}'),
  ('cultural_legibility','CULTURAL LEGIBILITY',  4, '{"1":"niche / insider-coded","2":"fashion-literate","3":"mixed","4":"broadly legible","5":"universal"}'),
  ('creative_behaviour', 'CREATIVE BEHAVIOUR',   5, '{"1":"highly controlled","2":"disciplined evolution","3":"balanced","4":"risk-embracing","5":"volatile/experimental"}'),
  ('femininity_register','FEMININITY REGISTER',  6, '{"1":"romantic / overtly feminine","3":"balanced","5":"androgynous / masculine-leaning"}'),
  ('silhouette_language','SILHOUETTE LANGUAGE',  7, '{"1":"body-conscious / precise","3":"balanced","5":"fluid / volume-led"}'),
  ('colour_identity',    'COLOUR IDENTITY',      8, '{"1":"strictly neutral-led","3":"balanced","5":"colour-and-print-led"}'),
  ('occasion_gravity',   'OCCASION GRAVITY',     9, '{"1":"everyday / casual","3":"balanced","5":"event / occasion dressing"}'),
  ('statement_density',  'STATEMENT DENSITY',   10, '{"1":"wardrobe-builder / basics","3":"balanced","5":"hero-piece brand"}'),
  ('sensuality_register','SENSUALITY REGISTER', 11, '{"1":"covered / demure","3":"balanced","5":"overtly body-revealing"}')
on conflict (dimension_key) do nothing;

create table if not exists public.brand_codes (
  brand_id uuid not null references public.brand(brand_id) on delete cascade,
  dimension_key text not null references public.brand_code_dimension(dimension_key),
  value numeric not null check (value >= 1 and value <= 5),
  updated_by text not null default 'chloe',
  updated_at timestamptz not null default now(),
  primary key (brand_id, dimension_key)
);

-- full edit history
create table if not exists public.brand_code_event (
  event_id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand(brand_id) on delete cascade,
  dimension_key text not null,
  old_value numeric,
  new_value numeric not null,
  updated_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_bce_brand on public.brand_code_event (brand_id, dimension_key, created_at);

-- Head start: the five legacy brand columns are exactly the first five code
-- dimensions — migrate their current values as initial authored codes.
insert into public.brand_codes (brand_id, dimension_key, value, updated_by)
select brand_id, d.key, v.val, 'migrated from brand columns'
from public.brand b,
lateral (values
  ('price_positioning',  b.price_tier::numeric),
  ('era_orientation',    b.era_orientation::numeric),
  ('aesthetic_output',   b.aesthetic_output::numeric),
  ('cultural_legibility',b.cultural_legibility::numeric),
  ('creative_behaviour', b.creative_behaviour::numeric)
) as v(key, val)
cross join lateral (select v.key) as d(key)
where v.val is not null and v.val between 1 and 5
on conflict (brand_id, dimension_key) do nothing;

alter table public.brand_codes enable row level security;
alter table public.brand_code_dimension enable row level security;
alter table public.brand_code_event enable row level security;
