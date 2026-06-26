-- 0012_saved_item.sql
-- Lets a signed-in early-access user save individual ITEMS (not just whole
-- outfits) into their wardrobe. Mirrors saved_outfit (migration 0010).

create table if not exists saved_item (
  user_id    uuid not null,
  item_id    uuid not null,
  outfit_id  uuid,            -- the outfit it was saved from (for taste context)
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create index if not exists saved_item_user_idx on saved_item (user_id);
create index if not exists saved_item_item_idx on saved_item (item_id);

alter table saved_item enable row level security;
-- Reads/writes go through the service-role client server-side (RLS bypassed);
-- no public policies, so the data stays locked down.
