-- 0049: Colours read from product photographs.
-- Run AFTER 0048, manually in the Supabase SQL editor (idempotent).
--
-- Colour is 3 of the 7 house-style points, so a feed that never states one
-- caps every piece at 4 and the brand can never clear a min score of 5. THE
-- POSSE scanned 624 products and queued nothing for exactly that reason.
-- Where no text carries the colourway, the scanner now reads it off the
-- product image — and caches the answer here, keyed on the image, so a
-- re-scan of the same catalogue never pays for the same read twice.
--
-- colour_family is nullable on purpose: a failed or unusable read is cached
-- too, so a broken image is not retried on every scan.
create table if not exists public.brand_watch_colour_read (
  image_url     text primary key,
  colour_family text,
  created_at    timestamptz not null default now()
);
alter table public.brand_watch_colour_read enable row level security;
-- Service-role only, same as the other scanner-side tables.
