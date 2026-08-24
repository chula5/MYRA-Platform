-- 0051_our_pick_outfits.sql
-- Let a curated OUR PICKS collection hold OUTFITS as well as items.
--
-- 'picks' and 'bags' are collections of products. 'mint' is a collection of
-- complete looks, so a pick row now points at EITHER an item or an outfit —
-- never both, never neither — while keeping one table, one ordering scheme and
-- one set of admin actions.

-- item_id becomes optional (an outfit pick has none).
alter table public.our_pick alter column item_id drop not null;

alter table public.our_pick
  add column if not exists outfit_id uuid;

-- Exactly one target per row. num_nonnulls keeps this readable and is enforced
-- on every write, so a malformed pick can't reach the public pages.
alter table public.our_pick drop constraint if exists our_pick_target_check;
alter table public.our_pick
  add constraint our_pick_target_check check (num_nonnulls(item_id, outfit_id) = 1);

-- The existing unique (collection, item_id) still holds for item picks:
-- Postgres treats NULLs as distinct, so outfit rows don't collide with it.
-- Outfit picks need their own partial unique index for the same guarantee.
create unique index if not exists our_pick_collection_outfit_idx
  on public.our_pick (collection, outfit_id)
  where outfit_id is not null;

create index if not exists our_pick_outfit_idx on public.our_pick (outfit_id);
