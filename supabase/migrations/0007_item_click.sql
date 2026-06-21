-- item_click: lightweight log of every retailer click-through from The Edit,
-- so admin can see which items are most popular. Written via the service-role
-- client (server action), same pattern as landing_event.

create table if not exists public.item_click (
  click_id   uuid        primary key default gen_random_uuid(),
  item_id    uuid        not null,
  outfit_id  uuid,
  clicked_at timestamptz not null default now()
);

create index if not exists item_click_item_id_idx   on public.item_click (item_id);
create index if not exists item_click_clicked_at_idx on public.item_click (clicked_at desc);

alter table public.item_click enable row level security;
