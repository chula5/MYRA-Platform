-- 0022_stylists_sets_autonomy.sql
-- Three interlocking systems:
--   A. STYLING SETS — the composer's unit of work is 3-4 outfits per hero item,
--      linked by styling_set_id.
--   B. AUTONOMY GRADUATION — per-stylist publishing stages (full review →
--      audited auto-publish → autonomous composition) driven by review metrics.
--   C. STYLISTS — one shared item library; stylists are lenses over it, never
--      separate inventories. All learning loops become per-stylist.

-- ── C. Stylist ───────────────────────────────────────────────────────────────
create table if not exists stylist (
  stylist_id    uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  type          text not null default 'persona',   -- 'real' | 'persona'
  status        text not null default 'draft',     -- draft | seeding | live | paused
  -- Full written ruleset, same structure as the House Style Constitution
  -- (core principle, statement budget, echo rules, material table, colour
  -- rules, bans, references). Null = use the built-in code constitution.
  constitution  jsonb,
  -- Operating envelope: per-dimension min/max over the 34-dim taste vector.
  -- { "min": number[34], "max": number[34], "tolerance": number }
  vector_range  jsonb,
  -- Reference images, each vision-scored into the 34-dim space, plus centroid.
  -- [{ "url": ..., "vector": number[34] }]
  moodboard     jsonb not null default '[]',
  centroid      jsonb,                              -- number[34]
  -- Tone/vocabulary for aesthetic labels and future chat.
  voice_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table stylist enable row level security;

-- Chloe is stylist 001: type real, live, built-in constitution.
insert into stylist (name, slug, type, status, voice_notes)
values ('Chloe', 'chloe', 'real', 'live',
        'MYRA house voice: editorial, oblique, unhurried. Rue de Rivoli mood. Never trend internet language.')
on conflict (slug) do nothing;

-- ── C. Item eligibility mask ─────────────────────────────────────────────────
-- One shared library; per-stylist lens. Manual overrides always win and are
-- never overwritten by re-scoring.
create table if not exists stylist_item_mask (
  id          uuid primary key default gen_random_uuid(),
  stylist_id  uuid not null references stylist(stylist_id) on delete cascade,
  item_id     uuid not null,
  eligibility text not null default 'eligible',   -- 'eligible' | 'excluded'
  source      text not null default 'auto',       -- 'auto' | 'manual'
  updated_at  timestamptz not null default now(),
  unique (stylist_id, item_id)
);
create index if not exists stylist_item_mask_item_idx on stylist_item_mask (item_id);
alter table stylist_item_mask enable row level security;

-- ── C. Per-stylist learned model ─────────────────────────────────────────────
-- Replaces the singleton style_model for multi-stylist learning. Chloe's row is
-- copied from the legacy singleton; the legacy table stays for rollback.
create table if not exists stylist_model (
  stylist_id     uuid primary key references stylist(stylist_id) on delete cascade,
  model          jsonb not null default '{}',
  house_style_md text,
  decisions      int not null default 0,
  updated_at     timestamptz not null default now()
);
alter table stylist_model enable row level security;

insert into stylist_model (stylist_id, model, house_style_md, decisions, updated_at)
select s.stylist_id, m.model, m.house_style_md, m.decisions, m.updated_at
from stylist s, style_model m
where s.slug = 'chloe' and m.id = 1
on conflict (stylist_id) do nothing;

-- ── B. Autonomy graduation state (per stylist, counts variants not sets) ─────
create table if not exists stylist_autonomy (
  stylist_id      uuid primary key references stylist(stylist_id) on delete cascade,
  stage           int not null default 1,        -- 1 full review | 2 audited auto-publish | 3 autonomous
  current_streak  int not null default 0,        -- consecutive fast-lane approvals with ZERO swaps
  reviewed_log    jsonb not null default '[]',   -- last 50: [{ at, swapped, lane }]
  stage2_since    timestamptz,                   -- when Stage 2 began (30 clean days → Stage 3)
  last_intervention_at timestamptz,              -- any audit swap/pull
  schedule        text not null default 'daily', -- Stage 3 compose cadence
  demotions       jsonb not null default '[]',   -- [{ at, from, to, reason }]
  updated_at      timestamptz not null default now()
);
alter table stylist_autonomy enable row level security;

insert into stylist_autonomy (stylist_id)
select stylist_id from stylist where slug = 'chloe'
on conflict (stylist_id) do nothing;

-- ── A. Styling sets + attribution on outfits ─────────────────────────────────
alter table outfit add column if not exists styling_set_id uuid;
alter table outfit add column if not exists stylist_id     uuid;
alter table outfit add column if not exists variant_direction text;   -- 'daytime' | 'evening' | 'layered' | 'weekend' | …
-- Stock sentinel pause bookkeeping: paused outfits drop to draft; these record
-- why and what to restore.
alter table outfit add column if not exists paused_reason      text;
alter table outfit add column if not exists paused_from_status text;
create index if not exists outfit_styling_set_idx on outfit (styling_set_id);
create index if not exists outfit_stylist_idx on outfit (stylist_id, status);

alter table composed_outfit add column if not exists styling_set_id    uuid;
alter table composed_outfit add column if not exists stylist_id        uuid;
alter table composed_outfit add column if not exists variant_direction text;
alter table composed_outfit add column if not exists set_size          int;
create index if not exists composed_outfit_set_idx on composed_outfit (styling_set_id);

-- Styling-set registry: hero + stylist + under-styled flag lives here, so a
-- set exists independent of how many variants are staged or live.
create table if not exists styling_set (
  styling_set_id uuid primary key default gen_random_uuid(),
  stylist_id     uuid not null,
  hero_item_id   uuid not null,
  status         text not null default 'reviewing',  -- reviewing | live | under_styled | paused
  target_size    int not null default 4,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists styling_set_hero_idx on styling_set (hero_item_id);
create index if not exists styling_set_stylist_idx on styling_set (stylist_id, status);
alter table styling_set enable row level security;

-- ── C. Learning loops become per-stylist ─────────────────────────────────────
-- Null stylist_id = legacy rows; backfilled to Chloe below.
alter table style_decision   add column if not exists stylist_id uuid;
alter table style_offer      add column if not exists stylist_id uuid;
alter table item_ejection    add column if not exists stylist_id uuid;
alter table swap_rule        add column if not exists stylist_id uuid;
alter table house_rejection  add column if not exists stylist_id uuid;
alter table material_pairing add column if not exists stylist_id uuid;
alter table calibration_report add column if not exists stylist_id uuid;

update style_decision   set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update style_offer      set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update item_ejection    set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update swap_rule        set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update house_rejection  set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update material_pairing set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update calibration_report set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;
update composed_outfit  set stylist_id = (select stylist_id from stylist where slug = 'chloe') where stylist_id is null;

-- swap_rule uniqueness must now be per-stylist.
alter table swap_rule drop constraint if exists swap_rule_slot_formality_band_dimension_from_value_to_value_key;
create unique index if not exists swap_rule_stylist_key
  on swap_rule (stylist_id, slot, formality_band, dimension, from_value, to_value);

-- material_pairing uniqueness per-stylist too.
alter table material_pairing drop constraint if exists material_pairing_pair_key_key;
create unique index if not exists material_pairing_stylist_key
  on material_pairing (stylist_id, pair_key);

-- ── B. Audit log for Stage 2/3 auto-published outfits ────────────────────────
create table if not exists auto_publish_log (
  id           uuid primary key default gen_random_uuid(),
  stylist_id   uuid not null,
  outfit_id    uuid not null,
  styling_set_id uuid,
  stage        int not null,
  published_at timestamptz not null default now(),
  audited_at   timestamptz,
  audit_action text                                -- null | 'kept' | 'swapped' | 'pulled'
);
create index if not exists auto_publish_log_stylist_idx on auto_publish_log (stylist_id, published_at desc);
alter table auto_publish_log enable row level security;
