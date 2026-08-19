-- 0032: Brand affinity system — brand vectors, curated families, per-user
-- brand taste, discovery tracking, and health reports.
-- Run AFTER 0031, manually in the Supabase SQL editor (idempotent).
--
-- Design notes:
-- · brand_vector is a 34-dim jsonb array in the SAME space as
--   outfit.taste_vector / user_taste_profile.taste_vector: the centroid of
--   single-item pseudo-outfit vectors over the brand's scored items
--   (outfit-only dims sit neutral at 0.5). Reference brands get theirs from
--   vision-scored reference images instead.
-- · user_brand_affinity.user_id holds a pilot_member.member_id today
--   (user_kind marks it), an auth user id when this goes site-wide.
-- · Rows in user_brand_affinity are never deleted — affinity decays to a
--   0.05 floor instead, and every change lands in brand_affinity_event.

-- ── brand: promote to a real entity ─────────────────────────────────────────
alter table public.brand add column if not exists aliases text[] not null default '{}';
alter table public.brand add column if not exists status text not null default 'stocked';
do $$ begin
  alter table public.brand add constraint brand_status_check check (status in ('stocked', 'reference'));
exception when duplicate_object then null; end $$;
alter table public.brand add column if not exists brand_vector jsonb;
alter table public.brand add column if not exists vector_item_count int not null default 0;
alter table public.brand add column if not exists vector_updated_at timestamptz;

-- ── curated families ────────────────────────────────────────────────────────
create table if not exists public.brand_family (
  family_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_family_membership (
  family_id uuid not null references public.brand_family(family_id) on delete cascade,
  brand_id uuid not null references public.brand(brand_id) on delete cascade,
  weight text not null default 'core' check (weight in ('core', 'adjacent')),
  created_at timestamptz not null default now(),
  primary key (family_id, brand_id)
);

-- manual kill-switch for bad adjacencies; store with brand_a < brand_b
create table if not exists public.brand_exclusion (
  brand_a uuid not null references public.brand(brand_id) on delete cascade,
  brand_b uuid not null references public.brand(brand_id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key (brand_a, brand_b)
);

-- similar_brands() cache; invalidated on vector recompute / family / exclusion edits
create table if not exists public.brand_similarity_cache (
  brand_id uuid primary key references public.brand(brand_id) on delete cascade,
  results jsonb not null,
  computed_at timestamptz not null default now()
);

-- ── per-user brand taste ────────────────────────────────────────────────────
create table if not exists public.user_brand_affinity (
  user_id uuid not null,
  user_kind text not null default 'pilot_member' check (user_kind in ('pilot_member', 'auth_user')),
  brand_id uuid not null references public.brand(brand_id) on delete cascade,
  affinity numeric not null default 0.1 check (affinity >= 0 and affinity <= 1),
  source text not null default 'expanded' check (source in ('onboarded', 'expanded', 'learned')),
  expansion_trace text,          -- "core family 'French contemporary' via Sézane"
  hidden boolean not null default false,
  positive_count int not null default 0,
  skip_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
create index if not exists idx_uba_brand on public.user_brand_affinity (brand_id);

-- append-only history: sparklines + debugging; also logs admin overrides
create table if not exists public.brand_affinity_event (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  brand_id uuid not null references public.brand(brand_id) on delete cascade,
  old_value numeric,
  new_value numeric not null,
  source text not null,          -- onboarded | expanded | learned | admin_override | hidden | decayed
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_bae_user on public.brand_affinity_event (user_id, brand_id, created_at);

-- ── discovery slots ─────────────────────────────────────────────────────────
create table if not exists public.discovery_impression (
  impression_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  outfit_id uuid,
  hero_brand_id uuid references public.brand(brand_id) on delete set null,
  seeded_from_brand_id uuid references public.brand(brand_id) on delete set null,
  mechanism text,                -- family name or "vector 0.72"
  context text not null default 'preview' check (context in ('preview', 'delivery', 'feed')),
  outcome text not null default 'ignored' check (outcome in ('ignored', 'skipped', 'engaged')),
  outcome_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_di_user on public.discovery_impression (user_id, created_at desc);
create index if not exists idx_di_brand on public.discovery_impression (hero_brand_id);

-- free-text brands named at onboarding that we couldn't match — stocking intel
create table if not exists public.unmatched_brand_log (
  log_id uuid primary key default gen_random_uuid(),
  raw_name text not null,
  user_id uuid,
  created_at timestamptz not null default now()
);

-- weekly health-check reports (calibration_report pattern: one row per week)
create table if not exists public.brand_health_report (
  week_start date primary key,
  report jsonb not null,
  created_at timestamptz not null default now()
);

-- service-role only, same as the other pilot/admin tables
alter table public.brand_family enable row level security;
alter table public.brand_family_membership enable row level security;
alter table public.brand_exclusion enable row level security;
alter table public.brand_similarity_cache enable row level security;
alter table public.user_brand_affinity enable row level security;
alter table public.brand_affinity_event enable row level security;
alter table public.discovery_impression enable row level security;
alter table public.unmatched_brand_log enable row level security;
alter table public.brand_health_report enable row level security;
