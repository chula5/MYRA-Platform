-- 0052: Learning attribution — which layer a lesson belongs to.
-- Run AFTER 0051, manually in the Supabase SQL editor (idempotent).
--
-- The harness learns from one client and must carry the transferable part to
-- the next WITHOUT carrying her personal taste with it. That needs every
-- signal to say which layer it belongs to, narrowest first:
--
--   client   this person only — her affinities, sizes, wardrobe, her swaps.
--   style    a reusable reference profile ("Scandi mum") that several clients
--            of the same stylist can share.
--   stylist  the stylist's constitution and taste rules. Chloe is stylist 001
--            and the House Style Constitution is HERS — every Chloe client
--            inherits it; another stylist has their own.
--   global   taste-independent only: the brand layer, vector scoring, composer
--            mechanics, and correctness (in stock, in size, no duplicate
--            slots). Nothing at global scope has an opinion about what looks
--            good.
--
-- Capture defaults to 'client'. Nothing generalises until evidence supports it.

alter table public.pilot_look_feedback add column if not exists scope text not null default 'client';
alter table public.pilot_look_feedback drop constraint if exists pilot_look_feedback_scope_check;
alter table public.pilot_look_feedback add constraint pilot_look_feedback_scope_check
  check (scope in ('client', 'style', 'stylist', 'global'));

-- 'manual' means she tagged it in review and it skips the promotion wait.
alter table public.pilot_look_feedback add column if not exists scope_source text not null default 'auto';
alter table public.pilot_look_feedback drop constraint if exists pilot_look_feedback_scope_source_check;
alter table public.pilot_look_feedback add constraint pilot_look_feedback_scope_source_check
  check (scope_source in ('auto', 'manual'));

-- ── Style profiles ─────────────────────────────────────────────────────────
-- A reference profile under ONE stylist. Built from a client's moodboard, then
-- reusable: a later client is either matched to an existing profile or gets a
-- new one through the same pipeline.
create table if not exists public.style_profile (
  profile_id       uuid primary key default gen_random_uuid(),
  stylist_id       uuid not null references public.stylist(stylist_id) on delete cascade,
  name             text not null,
  -- the client whose moodboard produced it, for provenance
  source_member_id uuid references public.pilot_member(member_id) on delete set null,
  -- where the scored moodboard images live, when it was seeded from a persona
  moodboard_persona_id uuid,
  vector           jsonb,
  envelope         jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_style_profile_stylist on public.style_profile (stylist_id);
alter table public.style_profile enable row level security;

-- Who a client belongs to. stylist_id is the layer she inherits in full.
alter table public.pilot_member add column if not exists stylist_id uuid references public.stylist(stylist_id);
alter table public.pilot_member add column if not exists style_profile_id uuid references public.style_profile(profile_id);
-- Snapshot at creation, so the inheritance report can say what she started from
-- even after the constitution moves on.
alter table public.pilot_member add column if not exists inherited_constitution_version int;

-- ── Promoted rules ─────────────────────────────────────────────────────────
-- A pattern that has earned a wider scope than the client it came from.
create table if not exists public.learned_rule (
  rule_id       uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('style', 'stylist', 'global')),
  stylist_id    uuid references public.stylist(stylist_id) on delete cascade,
  profile_id    uuid references public.style_profile(profile_id) on delete cascade,
  pattern_key   text not null,
  pattern_label text not null,
  -- which members and how often; a stylist rule needs 2+ members on DIFFERENT
  -- style profiles, so the provenance has to be kept, not just a count
  evidence      jsonb not null default '{}'::jsonb,
  occurrences   int not null default 0,
  member_count  int not null default 0,
  source        text not null default 'auto' check (source in ('auto', 'manual')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  promoted_at   timestamptz not null default now()
);
create unique index if not exists uq_learned_rule on public.learned_rule (scope, coalesce(stylist_id::text, ''), coalesce(profile_id::text, ''), pattern_key);
alter table public.learned_rule enable row level security;

-- The constitution belongs to a stylist and moves as it is refined.
alter table public.stylist add column if not exists constitution_version int not null default 1;

-- Chloe is stylist 001: the House Style Constitution is hers, not the global
-- layer. Every Chloe client inherits it; another stylist has their own.
update public.stylist set constitution_version = 1 where constitution_version is null;
update public.pilot_member m
   set stylist_id = (select stylist_id from public.stylist where slug = 'chloe' limit 1)
 where m.stylist_id is null;
