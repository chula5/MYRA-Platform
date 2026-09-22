-- 0060_mirror_phase1.sql
-- MYRA Mirror (the browser extension) — Phase 1.
--
--   member_saved_item   pieces a member hearted on any brand site. Keyed by
--                       pilot member, because most members have no auth user;
--                       stock alerts key on pilot_member.auth_user_id ?? member_id.
--   mirror_page_product products seen on single-brand sites and queued for
--                       image scoring, so the next visit ranks by piece.
--   recently_viewed     last pieces she opened MYRA on, across every site.
--
-- Service-role only: the mirror API resolves the member from her token.

create table if not exists public.member_saved_item (
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  item_id     uuid not null references public.item(item_id) on delete cascade,
  source_host text,
  saved_at    timestamptz not null default now(),
  primary key (member_id, item_id)
);
alter table public.member_saved_item enable row level security;
create index if not exists idx_member_saved_item_member on public.member_saved_item (member_id, saved_at desc);

create table if not exists public.mirror_page_product (
  id           uuid primary key default gen_random_uuid(),
  host         text not null,
  url          text not null unique,
  brand_name   text,
  title        text,
  image_url    text,
  product_type text,
  price_gbp    numeric,
  member_id    uuid references public.pilot_member(member_id) on delete set null,
  item_id      uuid references public.item(item_id) on delete set null,
  status       text not null default 'queued' check (status in ('queued', 'scored', 'failed')),
  attempts     int not null default 0,
  first_seen   timestamptz not null default now(),
  scored_at    timestamptz
);
alter table public.mirror_page_product enable row level security;
create index if not exists idx_mirror_page_product_queue on public.mirror_page_product (status, first_seen) where status = 'queued';

create table if not exists public.recently_viewed (
  member_id  uuid not null references public.pilot_member(member_id) on delete cascade,
  item_id    uuid not null references public.item(item_id) on delete cascade,
  host       text,
  viewed_at  timestamptz not null default now(),
  primary key (member_id, item_id)
);
alter table public.recently_viewed enable row level security;
create index if not exists idx_recently_viewed_member on public.recently_viewed (member_id, viewed_at desc);
