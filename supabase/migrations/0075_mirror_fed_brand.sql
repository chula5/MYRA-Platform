-- 0075: the shop MYRA cannot read from a server, watched through the Mirror.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Some shops cannot be scanned at all. Massimo Dutti answers every product
-- page with an Akamai bot challenge, publishes gzipped sitemaps holding a
-- handful of URLs and none for the UK, and refuses its own catalogue API —
-- so neither the Shopify route nor the browser route sees a single piece, and
-- the watchlist row was created and deleted again on every attempt (a request
-- left saying "full scan running" over a brand that was never on the list).
--
-- platform 'mirror' is the third route, and it fetches nothing: the pieces
-- arrive as she browses the shop herself, through the extension, and land in
-- the same queue with the same confidence as a scanned brand. The weekly cron
-- skips these rows rather than failing them.

alter table public.watched_brand drop constraint if exists watched_brand_platform_check;
alter table public.watched_brand add constraint watched_brand_platform_check
  check (platform in ('shopify', 'browser', 'mirror'));
