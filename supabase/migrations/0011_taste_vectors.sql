-- 0011_taste_vectors.sql
-- The per-user taste graph: an append-only log of every taste signal, plus the
-- aggregated 34-dimension taste vector that powers cosine recommendations.
--
-- NOTE: these tables already existed in the production database (set up with
-- pgvector + an event-type enum). This migration reflects that real schema and
-- is safe to run on a fresh database. The taste_vector is a pgvector vector(34);
-- PostgREST returns it as a string like "[0.1,0.2,...]" (parsed in app code).

create extension if not exists vector;

do $$ begin
  create type taste_event_type_enum as enum (
    'like', 'dislike', 'save', 'shop_click', 'style_tap', 'source_tap', 'similar_tap', 'explore_tap', 'skip'
  );
exception when duplicate_object then null; end $$;

-- Append-only interaction log (the proprietary per-user signal).
create table if not exists taste_event (
  event_id         uuid primary key default gen_random_uuid(),
  user_id          uuid not null,
  outfit_id        uuid references outfit(outfit_id),
  item_id          uuid references item(item_id),
  event_type       taste_event_type_enum not null,
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
  taste_vector     vector(34),
  brand_affinities text[] not null default '{}',
  price_tier_range integer[] not null default '{}',
  updated_at       timestamptz not null default now()
);

alter table user_taste_profile enable row level security;

-- Reads/writes go through the service-role (admin) client server-side, which
-- bypasses RLS; no public policies are granted, so the data stays locked down.
