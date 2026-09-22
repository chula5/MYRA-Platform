-- 0067: shops she asked MYRA to learn.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- The mirror can only re-order a shop it can read. On every other shop it now
-- offers to pass the site on instead of sitting silent — so the list of shops
-- worth supporting comes from where she actually shops, not from a guess.
create table if not exists public.mirror_site_request (
  request_id  uuid primary key default gen_random_uuid(),
  member_id   uuid references public.pilot_member(member_id) on delete set null,
  host        text not null,
  url         text,
  page_title  text,
  -- 'unsupported' (MYRA cannot read the shop) | 'no_grid' (read it, found no grid)
  reason      text not null default 'unsupported',
  times_asked int not null default 1,
  status      text not null default 'open' check (status in ('open', 'watching', 'declined')),
  note        text,
  first_asked_at timestamptz not null default now(),
  last_asked_at  timestamptz not null default now()
);

create unique index if not exists mirror_site_request_unique on public.mirror_site_request (coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), host);
create index if not exists mirror_site_request_status on public.mirror_site_request (status, last_asked_at desc);
alter table public.mirror_site_request enable row level security;
