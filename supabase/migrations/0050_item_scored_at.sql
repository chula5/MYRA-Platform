-- 0050: Remember that an item's photograph has been read.
-- Run AFTER 0049, manually in the Supabase SQL editor (idempotent).
--
-- The style dimensions (fit, structure, length, pattern …) are what the
-- composer ranks on, and items arriving from Brand Watch carry none of them:
-- 24 of 2,389 ready items had them on 2026-08-23. The backfill reads them off
-- the product photo, but "has it been read?" cannot be inferred from the
-- columns themselves — a bag legitimately has no rise or leg opening, so it
-- stays null however many times it is looked at, and the scorer would pay to
-- re-read the same unscorable pieces on every run.
--
-- scored_at records the attempt, not the outcome.
alter table public.item add column if not exists scored_at timestamptz;
create index if not exists idx_item_unscored on public.item (created_at desc)
  where scored_at is null;
