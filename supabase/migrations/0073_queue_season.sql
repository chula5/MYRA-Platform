-- 0073: the season of a queued piece.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Brand Watch reads a season for every piece it queues (src/lib/season.ts):
-- the shop's own code (AW26, SS25), else the kind of piece, else the material.
-- The queue leads with the season we are heading into and keeps the other one
-- behind a chip, so summer is not kept into the library as autumn starts.
alter table public.brand_watch_queue add column if not exists season text;        -- aw | ss | all
alter table public.brand_watch_queue add column if not exists season_code text;   -- "AW26"
create index if not exists idx_brand_watch_queue_season on public.brand_watch_queue (watched_brand_id, status, season);
