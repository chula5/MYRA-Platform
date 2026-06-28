-- 0016_style_brain.sql
-- "Style Brain": learns which outfit combinations Chloe approves (YES in the
-- Composer / Outfit Review) vs skips, and feeds that back into composer ranking.

-- Raw, append-only log of every decision (the training set — never overwritten,
-- so the model can always be recomputed from scratch).
create table if not exists style_decision (
  id          uuid primary key default gen_random_uuid(),
  decision    text not null,                 -- 'approve' | 'skip'
  source      text,                          -- 'composer' | 'review'
  anchor_item_id uuid,
  item_ids    uuid[] not null default '{}',
  features    jsonb not null default '{}',   -- extracted singles/pairs at decision time
  base_score  numeric,                       -- composer score when the decision was made
  created_at  timestamptz not null default now()
);
create index if not exists style_decision_created_idx on style_decision (created_at desc);
alter table style_decision enable row level security;

-- The live learned model — a single JSON blob the composer reads to re-rank.
-- Incrementally updated on each decision; also fully recomputable from the log.
create table if not exists style_model (
  id          int primary key default 1,
  model       jsonb not null default '{}',
  house_style_md text,                        -- human-readable "House Style" doc
  decisions   int not null default 0,
  updated_at  timestamptz not null default now(),
  constraint style_model_singleton check (id = 1)
);
alter table style_model enable row level security;
insert into style_model (id, model) values (1, '{}') on conflict (id) do nothing;
