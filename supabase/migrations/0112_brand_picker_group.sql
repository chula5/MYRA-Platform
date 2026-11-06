-- Where a brand sits in the onboarding / YOU brand picker, when it is not one
-- of the hand-written names in src/app/onboarding/brand-groups.ts.
--
-- Filled once a day by /api/cron/picker-brands (lib/picker-placement): a
-- stocked brand with pieces that the picker does not name is filed into a
-- group by key, or 'none' when it is a duplicate spelling of a brand already
-- there or a multi-brand shop. The picker appends filed brands to their
-- group's "+ more". Set it by hand to move a brand; 'none' keeps it out.

alter table public.brand add column if not exists picker_group text;
alter table public.brand add column if not exists picker_group_note text;
alter table public.brand add column if not exists picker_group_at timestamptz;
