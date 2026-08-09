-- 0021_house_style_constitution.sql
-- The House Style Constitution: generative principles + hard constraints that
-- run BEFORE vector scoring. This migration adds the item flags the rules need,
-- the tables that let the rules LEARN, and the mandatory render-fidelity log.

-- ── Item flags the constitution reads ────────────────────────────────────────
-- print_flag: 'tasteful' is the admin opt-in that allows leopard / polka dot.
-- neckline:   enables "high or covered neckline permits a bold necklace".
-- is_activewear: explicit override for the gymwear ban when the name isn't
--                obviously athletic.
alter table item add column if not exists print_flag     text;
alter table item add column if not exists neckline       text;
alter table item add column if not exists is_activewear  boolean;

comment on column item.print_flag is 'tasteful = leopard/polka permitted in outfits; null = default out';
comment on column item.neckline is 'high | covered | crew | turtleneck | boat | v | scoop | off_shoulder';

-- ── Material pairing table (grows from Chloé's own decisions) ────────────────
-- Seeded in code with the constitution's approved/rejected list; every pairing
-- she approves or swaps out is logged here and folded back into the rules.
create table if not exists material_pairing (
  id          uuid primary key default gen_random_uuid(),
  pair_key    text not null unique,          -- normalised, alphabetical: 'leather+silk'
  family_a    text not null,
  family_b    text not null,
  approvals   int  not null default 0,
  rejections  int  not null default 0,
  verdict     text,                          -- 'approved' | 'rejected' | null (undecided)
  updated_at  timestamptz not null default now()
);
alter table material_pairing enable row level security;

-- ── Collection selection signal (the learning mandate) ───────────────────────
-- Selection itself is taste signal: what she ingested from a collection scan
-- AND what she passed over. Feeds "propose which items belong on MYRA".
create table if not exists collection_selection (
  id            uuid primary key default gen_random_uuid(),
  brand_name    text not null,
  collection    text,
  scanned_at    timestamptz not null default now(),
  candidate     jsonb not null default '{}',  -- title/url/image/price as scanned
  selected      boolean not null,             -- true = ingested, false = passed over
  item_id       uuid,                         -- set when ingested
  created_at    timestamptz not null default now()
);
create index if not exists collection_selection_brand_idx on collection_selection (brand_name, scanned_at desc);
alter table collection_selection enable row level security;

-- ── Render fidelity checks (mandatory before publish) ────────────────────────
-- Every Higgsfield render is vision-compared against the source item images.
-- A render that misrepresents the clothes is brand-damaging, so a failed check
-- blocks publish until it passes or Chloé overrides it.
create table if not exists render_check (
  id           uuid primary key default gen_random_uuid(),
  outfit_id    uuid not null,
  image_url    text not null,
  attempt      int  not null default 1,
  passed       boolean not null default false,
  score        numeric,                       -- 0..1 overall fidelity
  issues       jsonb not null default '[]',   -- [{ item, field, expected, seen }]
  notes        text,
  needs_review boolean not null default false, -- true after a second failure
  created_at   timestamptz not null default now()
);
create index if not exists render_check_outfit_idx on render_check (outfit_id, created_at desc);
alter table render_check enable row level security;

-- ── House-rule rejection log (why candidates never reached review) ───────────
-- Rolled up on the Style Brain screen so an empty candidate pool is explainable
-- rather than mysterious.
create table if not exists house_rejection (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,                 -- e.g. 'echo.none', 'statement.multiple'
  rule        text,
  anchor_item_id uuid,
  count       int not null default 1,
  created_at  timestamptz not null default now()
);
create index if not exists house_rejection_created_idx on house_rejection (created_at desc);
alter table house_rejection enable row level security;
