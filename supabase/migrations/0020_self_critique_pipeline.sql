-- 0020_self_critique_pipeline.sql
-- Self-critiquing composer pipeline: vector scoring + swap history act as a
-- quality gate BEFORE outfits reach the review queue.
--
--   item_ejection      — every swap-out, with the context it happened in
--   swap_rule          — aggregated directional rules (colour: off-white→black …)
--   style_offer        — every candidate SHOWN, so house-style stats can be
--                        approval RATES (approvals / times offered), not counts
--   composed_outfit    — staged candidates with vector + confidence + lane
--   pipeline_config    — fast-lane threshold + override log (adaptive)
--   calibration_report — the Monday report, one row per week

create table if not exists item_ejection (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null,
  slot            text,                          -- slot the item was ejected from
  formality_band  text,                          -- 'casual' | 'mid' | 'dressy'
  occasion        text,                          -- occasion context if known
  anchor_item_id  uuid,
  replaced_by     uuid,                          -- incoming item (null = removed)
  deltas          jsonb not null default '{}',   -- { colour_family: {from,to}, … }
  created_at      timestamptz not null default now()
);
create index if not exists item_ejection_item_idx on item_ejection (item_id);
create index if not exists item_ejection_created_idx on item_ejection (created_at desc);
alter table item_ejection enable row level security;

create table if not exists swap_rule (
  id              uuid primary key default gen_random_uuid(),
  slot            text not null,
  formality_band  text not null default 'any',
  dimension       text not null,                 -- 'colour_family' | 'material_category' | …
  from_value      text not null,
  to_value        text not null,
  count           int not null default 1,
  updated_at      timestamptz not null default now(),
  unique (slot, formality_band, dimension, from_value, to_value)
);
alter table swap_rule enable row level security;

create table if not exists style_offer (
  id              uuid primary key default gen_random_uuid(),
  anchor_item_id  uuid,
  item_ids        uuid[] not null default '{}',
  features        jsonb not null default '{}',   -- singles/pairs shown
  source          text,                          -- 'composer' | 'review' | 'pipeline'
  created_at      timestamptz not null default now()
);
create index if not exists style_offer_created_idx on style_offer (created_at desc);
alter table style_offer enable row level security;

create table if not exists composed_outfit (
  id                  uuid primary key default gen_random_uuid(),
  anchor_item_id      uuid not null,
  item_ids            uuid[] not null,           -- additions (anchor excluded)
  slots               text[] not null,
  taste_vector        jsonb,                     -- 34-dim array at composition time
  base_score          numeric,                   -- composer coherence score
  confidence          numeric,                   -- gated score after penalties
  lane                text not null default 'standard',  -- 'fast' | 'standard'
  reasons             jsonb not null default '[]',        -- why it scored low
  occasion_scores     jsonb not null default '{}',        -- derived formality/time_of_day/…
  status              text not null default 'pending',    -- pending | approved | rejected
  overridden          boolean not null default false,     -- fast-lane approve with edits
  outfit_id           uuid,                      -- real outfit once approved
  prerender_status    text not null default 'none',       -- none | queued | done | failed
  prerender_image_url text,
  created_at          timestamptz not null default now(),
  decided_at          timestamptz
);
create index if not exists composed_outfit_status_idx on composed_outfit (status, lane);
create index if not exists composed_outfit_anchor_idx on composed_outfit (anchor_item_id);
alter table composed_outfit enable row level security;

create table if not exists pipeline_config (
  id                   int primary key default 1,
  fast_lane_threshold  numeric not null default 0.82,
  fast_lane_approvals  int not null default 0,
  fast_lane_overrides  int not null default 0,
  clean_streak         int not null default 0,   -- consecutive un-edited fast approvals
  threshold_log        jsonb not null default '[]',
  updated_at           timestamptz not null default now(),
  constraint pipeline_config_singleton check (id = 1)
);
alter table pipeline_config enable row level security;
insert into pipeline_config (id) values (1) on conflict (id) do nothing;

create table if not exists calibration_report (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null unique,
  report      jsonb not null default '{}',
  report_md   text,
  created_at  timestamptz not null default now()
);
alter table calibration_report enable row level security;
