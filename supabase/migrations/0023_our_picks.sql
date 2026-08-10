-- 0023_our_picks.sql
-- OUR PICKS — admin-curated item collections for the public feed.
--   'picks' → the OUR PICKS grid under New Outfits.
--   'bags'  → the destination when the headline bag is clicked (a curated bags
--             edit); future collections (shoes, jewellery…) are just new slugs.
-- When a collection is empty the front end falls back to an automatic
-- statement-first selection from the newest live outfits ('picks' only).
create table if not exists our_pick (
  id          uuid primary key default gen_random_uuid(),
  collection  text not null default 'picks',
  item_id     uuid not null,
  sort_order  int not null default 0,
  added_at    timestamptz not null default now(),
  unique (collection, item_id)
);
create index if not exists our_pick_collection_idx on our_pick (collection, sort_order);
alter table our_pick enable row level security;
