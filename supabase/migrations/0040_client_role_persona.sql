-- 0040: Client role, soft persona assignment, and inspiration uploads.
-- Run AFTER 0039, manually in the Supabase SQL editor (idempotent).
--
-- A pilot client (first instance: Mum) signs in, sees her own profile, and
-- uploads outfits she likes. Three ideas hold this together:
--
--   soft persona  A client is assigned to a persona at weight 0.9, and the
--                 weight DECAYS as she behaves. The persona is a prior that
--                 fades into her own taste — never a bucket she sits in.
--   two pools     Uploads are aspirational; swipes, saves and click-outs are
--                 behavioural. They are never merged: the gap between what she
--                 saves and what she aspires to is itself the finding.
--   no admin      The client role grants nothing in /admin. Admin stays locked
--                 to the single hardcoded admin user id, exactly as before.

-- ── Soft persona assignment ────────────────────────────────────────────────
create table if not exists public.user_persona (
  user_id     uuid primary key,
  persona_id  uuid not null references public.stylist(stylist_id) on delete cascade,
  -- 0.9 at assignment; decays with behavioural events, floored at 0.3 so the
  -- persona never disappears entirely.
  weight      real not null default 0.9 check (weight >= 0 and weight <= 1),
  assigned_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_user_persona_persona on public.user_persona (persona_id);
alter table public.user_persona enable row level security;

-- Append-only weight history — "her persona weight over time" in the admin view.
create table if not exists public.user_persona_weight_log (
  log_id        uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  persona_id    uuid not null references public.stylist(stylist_id) on delete cascade,
  weight        real not null,
  event_count   int not null default 0,   -- behavioural events at the time
  created_at    timestamptz not null default now()
);
create index if not exists idx_upwl_user on public.user_persona_weight_log (user_id, created_at);
alter table public.user_persona_weight_log enable row level security;

-- ── Inspiration uploads as a taste signal ──────────────────────────────────
-- Uploads carry weight like any other signal, but sit in the ASPIRATIONAL pool.
-- Adding to the enum is safe to re-run.
do $$ begin
  alter type taste_event_type_enum add value if not exists 'inspiration_upload';
exception when undefined_object then
  -- Fresh database where 0011's enum hasn't been created yet.
  null;
end $$;

-- Which pool a taste event belongs to. Behavioural events drive the persona
-- decay; aspirational ones never do.
alter table public.taste_event add column if not exists pool text
  check (pool in ('behavioural', 'aspirational'));

-- Links an inspiration image back to the event it produced, so the two pools
-- can be compared later without guessing.
alter table public.taste_event add column if not exists inspiration_image_id uuid;

-- ── Client bookkeeping ─────────────────────────────────────────────────────
-- The auth user carries role='client' in user_metadata (same pattern as
-- early_access). This table holds what admin needs to list and manage them.
create table if not exists public.client_profile (
  user_id     uuid primary key,
  name        text not null,
  email       text,
  persona_id  uuid references public.stylist(stylist_id) on delete set null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table public.client_profile enable row level security;
-- Service-role only: no anon policies on any table here.
