-- 0047: Repair the item.neckline / item.sleeve columns.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- WHAT WENT WRONG
-- 0021_house_style_constitution.sql added `neckline` as TEXT ('high' | 'crew' |
-- 'v' | …). 0042_item_neckline_sleeve.sql later added `neckline` and `sleeve`
-- as INT 1-5 — but with `add column if not exists`, so on a database where 0021
-- had already run, the neckline half was a silent no-op. On this database 0042
-- never ran at all: `neckline` is still text and `sleeve` does not exist.
--
-- The consequence is not cosmetic. Every writer in the app treats both as
-- int 1-5 (ItemForm, extractItemFields, the vision passes, the taste vector,
-- the house-style rules, the wardrobe import). So today:
--   · any insert naming `sleeve` fails outright — "Could not find the 'sleeve'
--     column of 'item' in the schema cache" — which is what broke saving an
--     item and approving a wardrobe piece;
--   · `neckline` silently stores "3" as text and reads back as a string, so
--     house-style's num() sees null and the neckline rules never fire.
--
-- Converting neckline is safe here: it holds no non-null values (verified
-- before writing this). The USING clause keeps any digit it finds and nulls
-- anything else, so a database that DID store words ('crew', 'v') loses those
-- unscored words rather than failing the migration — they were never readable
-- as scores anyway and the vision pass will re-score them.

-- ── item.sleeve ─────────────────────────────────────────────────────────────
alter table public.item add column if not exists sleeve int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_sleeve_range'
  ) then
    alter table public.item
      add constraint item_sleeve_range check (sleeve is null or sleeve between 1 and 5);
  end if;
end $$;

comment on column public.item.sleeve is '1=SLEEVELESS -> 5=FULL LONG SLEEVE';

-- ── item.neckline: text → int ───────────────────────────────────────────────
do $$
declare
  kind text;
begin
  select data_type into kind
  from information_schema.columns
  where table_schema = 'public' and table_name = 'item' and column_name = 'neckline';

  if kind is null then
    alter table public.item add column neckline int;
  elsif kind <> 'integer' then
    -- drop any check/default tied to the old text shape first
    alter table public.item alter column neckline drop default;
    execute $conv$
      alter table public.item
        alter column neckline type int
        using nullif(regexp_replace(neckline::text, '[^0-9]', '', 'g'), '')::int
    $conv$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'item_neckline_range'
  ) then
    alter table public.item
      add constraint item_neckline_range check (neckline is null or neckline between 1 and 5);
  end if;
end $$;

comment on column public.item.neckline is '1=HIGH/CLOSED (crew, funnel) -> 5=PLUNGING/LOW';

-- ── taste_log carries an item's attributes at edit time ─────────────────────
-- (the other half of 0042 — without these, every item save logs a failed insert)
alter table public.taste_log add column if not exists neckline int;
alter table public.taste_log add column if not exists sleeve   int;
