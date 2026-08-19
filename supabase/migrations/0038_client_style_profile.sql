-- 0038: Client style profile — the structured questionnaire that runs between
-- the brand picker and the outfit-rating swipes at onboarding.
-- Run AFTER 0037, manually in the Supabase SQL editor (idempotent).
--
-- Swipes reveal taste but not boundaries. This captures what a rating flow
-- can't: the colours she will not wear, the lengths she won't show, what she
-- can actually spend. Two classes of answer, and the split is load-bearing:
--
--   HARD  colour_never, length_no_go, heel_preference, price_comfort
--         → filter inventory absolutely (the item mask). Never overridden.
--   SOFT  everything else
--         → a one-time prior on the taste vector, worth ~3 swipe likes.
--           Ratings override it. Soft answers NEVER filter inventory.
--
-- Every question is skippable: null means "no constraint", never "unknown yes".
-- Colour values match the item.colour_family vocabulary (text, as everywhere
-- else in this schema — the app validates against the ColourFamily union).

create table if not exists public.client_style_profile (
  user_id          uuid primary key,

  -- HARD ────────────────────────────────────────────────────────────────────
  colour_never     text[],   -- colours she will not wear
  length_no_go     text[],   -- mini | above_knee | cropped_top | sleeveless | low_neckline | high_heel
  heel_preference  text check (heel_preference in ('flats_only', 'low_heel_ok', 'any')),
  price_comfort    int[],    -- [min_tier, max_tier] against brand.price_tier (asked in £, never shown as tiers)

  -- SOFT ────────────────────────────────────────────────────────────────────
  colour_loved     text[],   -- colours she gravitates to (vector nudge only)
  fit_top          int check (fit_top between 1 and 5),      -- 1 = fitted → 5 = oversized
  fit_bottom       int check (fit_bottom between 1 and 5),
  pattern_appetite int check (pattern_appetite between 1 and 5), -- 1 = solid only → 5 = statement print
  occasion_mix     jsonb,    -- { "work": "often", "casual_daily": "sometimes", ... }

  -- Free text ───────────────────────────────────────────────────────────────
  brands_missed    text,
  notes            text,

  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.client_style_profile enable row level security;
-- Reads/writes go through the service-role client server-side (same pattern as
-- user_taste_profile); no public policies, so the data stays locked down.

-- Marks the vector prior as already applied, so re-running onboarding can't
-- stack the same soft nudge twice.
alter table public.client_style_profile
  add column if not exists prior_applied_at timestamptz;
