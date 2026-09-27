-- 0072: what she looked at and searched for, from the Mirror.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- FOR YOU used to draw only on what she SAVED. The Mirror now also notes the
-- pieces she lingers on and what she types into a shop's search, so MYRA can
-- carry on from where she was without her having to keep anything.
alter table public.recently_viewed add column if not exists dwell_ms integer not null default 0;
alter table public.recently_viewed add column if not exists views integer not null default 1;

create table if not exists public.mirror_search (
  member_id         uuid not null references public.pilot_member(member_id) on delete cascade,
  host              text not null,
  query             text not null,
  times_searched    int not null default 1,
  first_searched_at timestamptz not null default now(),
  last_searched_at  timestamptz not null default now(),
  primary key (member_id, host, query)
);
alter table public.mirror_search enable row level security;
create index if not exists idx_mirror_search_member on public.mirror_search (member_id, last_searched_at desc);
