-- 0051: Where she is going, not just what for.
-- Run AFTER 0050, manually in the Supabase SQL editor (idempotent).
--
-- "Trips" covers a ski week and a beach week, and nothing in the delivery told
-- them apart — the travel prior actively favours knitwear, so a hot holiday
-- came back with jumpers and boots. Climate is its own axis rather than more
-- occasions, because a heatwave changes what she wears to work and to dinner
-- too, and doubling the occasion list would say the same thing six times.
--
-- Null means unstated, which behaves exactly as before.
alter table public.pilot_delivery add column if not exists climate text;

alter table public.pilot_delivery drop constraint if exists pilot_delivery_climate_check;
alter table public.pilot_delivery add constraint pilot_delivery_climate_check
  check (climate is null or climate in ('hot', 'temperate', 'cold'));
