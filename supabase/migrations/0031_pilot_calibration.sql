-- 0031_pilot_calibration.sql
-- Taste-calibration sets for the PRIVATE STYLIST pilot. Run AFTER 0030.
--
-- A calibration set is an extra onboarding step: 3 looks spread across the
-- three rooms, shown to the member purely for LIKE / DISLIKE. It is not a
-- shoppable delivery — no occasion, no stock promise — so the trigger enum
-- grows and occasion becomes nullable.

alter table public.pilot_delivery drop constraint if exists pilot_delivery_trigger_check;
alter table public.pilot_delivery
  add constraint pilot_delivery_trigger_check
  check (trigger in ('request', 'anticipation', 'calibration'));

alter table public.pilot_delivery alter column occasion drop not null;
-- (the existing occasion check constraint passes automatically on null)
