-- 0094 · WAYS TO WEAR IT — what MYRA styled around a piece for her, kept.
--
-- Until now every outfit a member asked for around one piece was composed,
-- judged by MYRA's eye, shown once and thrown away: the next tap paid again
-- and waited again. These two tables are the memory and the queue.
--
-- styled_way      one passing look around one hero piece for one member. The
--                 whole look is stored (items jsonb, the same shape as
--                 pilot_look.items) so it survives a piece being delisted; the
--                 ids are kept alongside (item_ids) so stock changes can find it.
--                 A row goes `stale` when a piece in it sells out (the sentinel
--                 marks it; reads also drop it on sight) and is never shown again.
--
-- styled_way_job  one request to style one hero for one member. priority 1 is
--                 a tap (she is waiting), 2 is a warm-up (pieces she is about
--                 to be able to tap). One open job per member + hero.
--
-- Service-role only, like every other pilot table: RLS on, no policies. Her app
-- reaches these through server actions that resolve the member from her session.

create table if not exists public.styled_way (
  styled_way_id    uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.pilot_member(member_id) on delete cascade,
  hero_item_id     text not null,
  -- blend (default) | wardrobe | inspiration — the Mirror's three pools.
  mode             text not null default 'blend' check (mode in ('blend','wardrobe','inspiration')),
  items            jsonb not null default '[]'::jsonb,
  item_ids         text[] not null default '{}',
  items_signature  text not null,
  verdict          text not null check (verdict in ('works','borderline')),
  confidence       numeric,
  why              text not null default '',
  occasion_id      text,
  occasion_label   text,
  source           text not null check (source in ('tap','warmup','mcp','mirror')),
  judged_at        timestamptz not null default now(),
  stale            boolean not null default false,
  stale_reason     text,
  created_at       timestamptz not null default now(),
  unique (member_id, hero_item_id, mode, items_signature)
);
alter table public.styled_way enable row level security;
create index if not exists styled_way_fresh_idx on public.styled_way (member_id, hero_item_id, mode) where not stale;
create index if not exists styled_way_item_ids_idx on public.styled_way using gin (item_ids);

create table if not exists public.styled_way_job (
  job_id         uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.pilot_member(member_id) on delete cascade,
  hero_item_id   text not null,
  mode           text not null default 'blend' check (mode in ('blend','wardrobe','inspiration')),
  priority       int not null default 2,
  -- Why it was asked for: tap | more | save | view | feed | wardrobe.
  reason         text not null default 'tap',
  shuffle        int not null default 0,
  status         text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts       int not null default 0,
  error          text,
  composed       int,
  passed         int,
  first_look_ms  int,
  total_ms       int,
  cost_gbp       numeric,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
alter table public.styled_way_job enable row level security;
create index if not exists styled_way_job_pick_idx on public.styled_way_job (status, priority, created_at);
create index if not exists styled_way_job_member_idx on public.styled_way_job (member_id, created_at);
-- One open job per member + hero + mode: a second tap joins the first.
create unique index if not exists styled_way_job_open_idx
  on public.styled_way_job (member_id, hero_item_id, mode) where status in ('queued','running');
