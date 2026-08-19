-- 0039: Inspiration images — a persona's moodboard as scored, persistent records.
-- Run AFTER 0038, manually in the Supabase SQL editor (idempotent).
--
-- The moodboard used to be a jsonb blob of borrowed URLs on stylist.moodboard.
-- Now every image is a row: re-hosted on Cloudinary (the original link can rot
-- or hotlink-block), vision-scored, then reviewed by hand. Only CONFIRMED
-- images shape the persona's envelope — a pending or rejected image has no
-- influence at all.
--
-- Corrections are kept, not overwritten: scores_original holds what the vision
-- pass said, scores holds the truth after review. The delta between them is
-- training data for the scorer.
--
-- Persona-scoped, and inventory-free by design: an inspiration image never
-- becomes an item. There is still exactly one shared item library — this only
-- shapes the lens that reads it.

create table if not exists public.inspiration_image (
  image_id         uuid primary key default gen_random_uuid(),
  persona_id       uuid not null references public.stylist(stylist_id) on delete cascade,
  -- set when a client supplied the image rather than the curator
  user_id          uuid,

  -- Always the re-hosted copy. The original link is kept only for provenance.
  image_url        text not null,
  source_url       text,

  source           text not null default 'curator_seed'
                     check (source in ('curator_seed', 'user_upload', 'runway', 'campaign', 'street_style', 'social')),
  status           text not null default 'pending_scoring'
                     check (status in ('pending_scoring', 'scored', 'confirmed', 'rejected')),

  -- { construction, volume, colour_story, surface_story, pattern,
  --   colour_depth, sheen, formality, item_types: text[] }
  scores           jsonb,
  -- The vision pass's untouched output — kept so corrections stay measurable.
  scores_original  jsonb,
  corrected_fields text[] not null default '{}',
  corrected_at     timestamptz,

  occasion_read    text[],
  score_confidence int check (score_confidence between 1 and 5),
  -- 34-dim vector derived from the scores; the envelope is computed from these.
  vector           jsonb,

  scoring_error    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_inspiration_persona on public.inspiration_image (persona_id, status);
-- Low confidence sorts first in the review grid.
create index if not exists idx_inspiration_review on public.inspiration_image (persona_id, score_confidence);

alter table public.inspiration_image enable row level security;
-- No anon policies: service-role only, same as the other admin-side tables.

-- ── Envelope bookkeeping on the persona ─────────────────────────────────────
-- The envelope is per-dimension mean AND spread over confirmed images. Spread
-- is the tolerance: a persona confident about volume and loose about colour
-- should be read that way, not flattened to one global margin.
alter table public.stylist add column if not exists envelope jsonb;
-- Set when confirmed images change after go-live. The persona keeps behaving as
-- it did until the rules are re-reviewed — the envelope never moves silently.
alter table public.stylist add column if not exists envelope_status text
  check (envelope_status in ('current', 'needs_review'));
alter table public.stylist add column if not exists envelope_computed_at timestamptz;
