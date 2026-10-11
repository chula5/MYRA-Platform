-- WAYS TO WEAR IT — the demand ledger.
--
-- What each member has had in front of her, per piece and per mode: a card she
-- lingered on in Browse, the piece she picked, a look she opened, what FOR YOU
-- showed, what she saved or viewed through the Mirror. Every surface writes
-- here; the nightly warm-up reads what is not yet covered; the admin coverage
-- tile divides pieces with three fresh ways by pieces surfaced; taps and
-- instant answers are counted on the row so "how often is a tap instant" needs
-- no client timing. Service-role only, like styled_way.

create table if not exists public.styled_way_demand (
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  hero_item_id  text not null,
  mode          text not null default 'blend' check (mode in ('blend','wardrobe','inspiration')),
  -- browse | pick | look | feed | save | view | wardrobe | tap | nightly — the last surface that showed it
  source        text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen          int not null default 1,
  taps          int not null default 0,
  -- taps answered from the memory with three ways, nothing composed
  tap_hits      int not null default 0,
  primary key (member_id, hero_item_id, mode)
);

create index if not exists styled_way_demand_recent_idx on public.styled_way_demand (member_id, last_seen_at desc);
create index if not exists styled_way_demand_first_seen_idx on public.styled_way_demand (first_seen_at);

alter table public.styled_way_demand enable row level security;

-- Record that pieces were put in front of her. A repeat bumps `seen` and the time.
create or replace function public.styled_way_notice(p_member_id uuid, p_hero_ids text[], p_mode text, p_source text)
returns void
language sql
as $$
  insert into public.styled_way_demand (member_id, hero_item_id, mode, source)
  select p_member_id, h, p_mode, p_source from unnest(p_hero_ids) as h
  on conflict (member_id, hero_item_id, mode) do update
    set seen = public.styled_way_demand.seen + 1,
        last_seen_at = now(),
        source = excluded.source;
$$;

-- Record a tap, and whether it was answered from the memory at once.
create or replace function public.styled_way_tap(p_member_id uuid, p_hero_id text, p_mode text, p_hit boolean)
returns void
language sql
as $$
  insert into public.styled_way_demand (member_id, hero_item_id, mode, source, taps, tap_hits)
  values (p_member_id, p_hero_id, p_mode, 'tap', 1, case when p_hit then 1 else 0 end)
  on conflict (member_id, hero_item_id, mode) do update
    set taps = public.styled_way_demand.taps + 1,
        tap_hits = public.styled_way_demand.tap_hits + (case when p_hit then 1 else 0 end),
        last_seen_at = now();
$$;
