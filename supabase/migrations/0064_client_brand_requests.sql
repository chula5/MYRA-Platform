-- 0064_client_brand_requests.sql
-- THE BRANDS SHE ASKS FOR HERSELF.
--
-- From here a client names her own favourite brands, in onboarding and in her
-- settings, rather than only having them read to her from what Chloe entered
-- at intake. Almost none of that needs new storage: a named brand is a
-- user_brand_affinity row at 1.0 with source 'onboarded', exactly as it is
-- when Chloe names it, and 0032 already logs a name MYRA cannot match to
-- unmatched_brand_log.
--
-- Two notes on what is deliberately NOT changed:
--
-- · source stays 'onboarded' for a brand she adds herself. The column means
--   "she named this", not "who typed it", and applyBrandSignals depends on
--   that: a positive signal promotes 'expanded' to 'learned' but must never
--   overwrite 'onboarded'. A separate 'client' value would quietly demote her
--   own brands the first time she liked something. Who added it is recorded
--   in brand_affinity_event.source instead, which is append-only and is where
--   provenance belongs.
--
-- · nothing here writes watched_brand. That table is the global Shopify
--   scanner: a row costs a full catalogue scrape and needs a storefront URL,
--   not a brand name. A client asking for a brand is intelligence for Chloe,
--   who decides whether to stock or watch it — so the request surfaces in the
--   admin and stops there.
--
-- All this migration adds is the ability to work through that request list.
-- Without it unmatched_brand_log only grows, and a list that can never be
-- cleared stops being read.

-- When Chloe has dealt with a request — stocked it, put it on the watchlist,
-- or decided against it. Null means it is still waiting.
alter table public.unmatched_brand_log add column if not exists handled_at timestamptz;
-- What she decided, for the ones she said no to: "too fast-fashion for her".
alter table public.unmatched_brand_log add column if not exists note text;

-- The admin reads this newest-first and filters to the unhandled.
create index if not exists idx_unmatched_brand_pending
  on public.unmatched_brand_log (created_at desc)
  where handled_at is null;

create index if not exists idx_unmatched_brand_user
  on public.unmatched_brand_log (user_id, created_at desc);

-- RLS is already on from 0032, still with no policies: service-role only.
