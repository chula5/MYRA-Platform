-- 0011_taste_vectors.sql
-- The per-user taste graph: an append-only log of every taste signal, plus the
-- aggregated 34-dimension taste vector that powers cosine recommendations.
-- Vectors are stored as JSON arrays (the catalogue is small enough to score in
-- the app); the column can later be migrated to pgvector without code changes.

-- Append-only interaction log (the "moat" — the proprietary per-user signal).
create table if not exists taste_event (
  event_id         uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  outfit_id        uuid,
  item_id          uuid,
  event_type       text not null,            -- like | dislike | save | shop_click | style_tap | source_tap | similar_tap | explore_tap | skip
  signal_weight    real not null default 0,
  occasion_context text,
  created_at       timestamptz not null default now()
);

create index if not exists taste_event_user_idx on taste_event (user_id);
create index if not exists taste_event_created_idx on taste_event (created_at);

alter table taste_event enable row level security;

-- Aggregated per-user taste profile (one row per user).
create table if not exists user_taste_profile (
  user_id          uuid primary key,
  taste_vector     jsonb,                     -- float[34] as a JSON array
  event_count      integer not null default 0,
  brand_affinities text[] not null default '{}',
  price_tier_range integer[],
  updated_at       timestamptz not null default now()
);

alter table user_taste_profile enable row level security;

-- Reads/writes go through the service-role (admin) client server-side, which
-- bypasses RLS; no public policies are granted, so the data stays locked down.
