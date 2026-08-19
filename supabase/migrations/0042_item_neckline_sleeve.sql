-- 0042: Neckline and sleeve as real item scores.
-- Run AFTER 0041, manually in the Supabase SQL editor (idempotent).
--
-- The style questionnaire lets a client rule out SLEEVELESS and LOW NECKLINES
-- as hard constraints, but the item schema had no field for either — so those
-- two rules fell back to matching words in product names, which misses most
-- pieces. These make them enforceable the same way colour and length are.
--
-- Same 1-5 convention as every other item score, so ItemForm, the vision
-- passes and the taste vector all treat them like the rest of the taxonomy.
alter table public.item
  add column if not exists neckline int check (neckline between 1 and 5),
  add column if not exists sleeve   int check (sleeve between 1 and 5);

comment on column public.item.neckline is '1=HIGH/CLOSED (crew, funnel) -> 5=PLUNGING/LOW';
comment on column public.item.sleeve   is '1=SLEEVELESS -> 5=FULL LONG SLEEVE';

-- The taste log records an item's attributes at edit time, so it carries these
-- two as well — otherwise every item save would log a failed insert.
alter table public.taste_log
  add column if not exists neckline int,
  add column if not exists sleeve   int;
