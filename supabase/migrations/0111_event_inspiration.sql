-- EVENT PICTURES AND NEVERS — what she loves for one occasion, and what she
-- does not want.
--
-- An event's brief (0099) is words. Pictures say more: seven satin dresses in
-- deep colours say "liquid, sleeved, rich" better than any sentence. Each
-- picture is scored by the same vision pass as an inspiration image (same
-- 34-dim vector) and read for its colours, so event picks can lean toward the
-- pictures she loves and away from the ones she marked "not this".
--
-- Her nevers sit on the event itself: her words ("nothing fussy, not mother of
-- the bride"), a price cap for the piece, and brands she does not want for it.

alter table public.pilot_known_event add column if not exists nevers text;
alter table public.pilot_known_event add column if not exists max_price_gbp numeric;
alter table public.pilot_known_event add column if not exists never_brands text[] not null default '{}';

create table if not exists public.event_inspiration_image (
  image_id         uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.pilot_member(member_id) on delete cascade,
  known_event_id   uuid not null references public.pilot_known_event(event_id) on delete cascade,
  -- love: more like this. not: never like this.
  kind             text not null default 'love' check (kind in ('love', 'not')),
  image_url        text not null,
  -- 'upload:sha1:<hash>' so the same picture is never added twice.
  source_url       text,
  status           text not null default 'pending_scoring'
                     check (status in ('pending_scoring', 'scored', 'failed')),
  scores           jsonb,
  occasion_read    text[],
  score_confidence int check (score_confidence between 1 and 5),
  vector           jsonb,
  -- Colour families seen in the picture (the vector carries no hue).
  colours          text[] not null default '{}',
  scoring_error    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists event_inspiration_image_event_idx on public.event_inspiration_image (known_event_id);
create index if not exists event_inspiration_image_member_idx on public.event_inspiration_image (member_id);

alter table public.event_inspiration_image enable row level security;
