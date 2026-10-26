-- STYLE INFLUENCES — the people whose style a client loves: celebrities,
-- influencers, muses, a house's look. Asked at application ("Whose style
-- inspires you?"), kept as people with pictures, and laid ON TOP of a member's
-- stylist persona: house (Chloe) → persona → influences → her own evidence.
--
-- An influence is NOT a stylist. It never composes for anyone and never learns
-- from anyone's yes/no; it is reference, like her own inspiration pictures,
-- shared across every member who names the same person.

create table if not exists public.style_influence (
  influence_id uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  kind         text not null default 'celebrity'
                 check (kind in ('celebrity', 'influencer', 'muse', 'house')),
  handle       text,
  -- The portrait a member taps in the picker.
  image_url    text,
  -- { summary, signatures[], palette[], silhouettes[], nevers[] } — words the
  -- look check and her memory read. See src/lib/style-influence.ts.
  brief        jsonb not null default '{}'::jsonb,
  -- draft: Chloe only. live: offered to members in the picker.
  status       text not null default 'draft' check (status in ('draft', 'live')),
  -- Mean + spread + looks of the scored pictures, recomputed on every change.
  envelope     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The influence's pictures, scored exactly like inspiration_image (same vision
-- pass, same 34-dim vector), so they sit in the same space as everything else.
create table if not exists public.style_influence_image (
  image_id         uuid primary key default gen_random_uuid(),
  influence_id     uuid not null references public.style_influence(influence_id) on delete cascade,
  image_url        text not null,
  source_url       text,
  status           text not null default 'pending_scoring'
                     check (status in ('pending_scoring', 'scored', 'rejected')),
  scores           jsonb,
  occasion_read    text[],
  score_confidence int check (score_confidence between 1 and 5),
  vector           jsonb,
  scoring_error    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists style_influence_image_influence_idx on public.style_influence_image (influence_id);

-- Who a member is inspired by. source = where the link came from: Chloe
-- (from her application / call), or the member tapping it herself.
create table if not exists public.member_style_influence (
  member_id    uuid not null references public.pilot_member(member_id) on delete cascade,
  influence_id uuid not null references public.style_influence(influence_id) on delete cascade,
  source       text not null default 'chloe' check (source in ('chloe', 'member', 'application')),
  created_at   timestamptz not null default now(),
  primary key (member_id, influence_id)
);
create index if not exists member_style_influence_influence_idx on public.member_style_influence (influence_id);

alter table public.style_influence enable row level security;
alter table public.style_influence_image enable row level security;
alter table public.member_style_influence enable row level security;

-- ── First person: Gillian Anderson (Anne named her at application) ──────────
-- Brief written from the eight pictures Chloe sent on 2026-10-26. Pictures are
-- added on /admin/influences (they need hosting + scoring, which SQL can't do).
insert into public.style_influence (name, slug, kind, handle, status, brief) values (
  'Gillian Anderson', 'gillian-anderson', 'celebrity', '@gilliana', 'draft',
  jsonb_build_object(
    'summary', 'Polished, grown-up femininity: almost always a midi dress — a sleeveless column or a belted shirt dress with a full pleated skirt — in black, navy or ivory. Texture (tweed, bouclé, pleats, appliqué) instead of print; one deep accent; pointed pumps or a fine strappy sandal.',
    'signatures', jsonb_build_array(
      'sleeveless column midi dress', 'belted shirt dress with a full pleated midi skirt', 'tweed or bouclé dress',
      'high-neck pleated chiffon dress', 'cardigan over a crisp shirt with a pleated plaid midi skirt',
      'pointed-toe pumps and slingbacks', 'fine ankle-strap sandals', 'structured top-handle bag', 'small gold hoops'),
    'silhouettes', jsonb_build_array('boat or high neckline', 'defined waist', 'midi to ankle length', 'fitted bodice, column or full pleated skirt'),
    'palette', jsonb_build_array('black', 'navy', 'ivory', 'white', 'burgundy accent', 'pale blue'),
    'nevers', jsonb_build_array('short hemlines', 'busy prints', 'visible logos', 'plunging necklines', 'slouchy streetwear')
  )
) on conflict (slug) do nothing;

-- Link Anne, only if exactly one real member is called Anne.
do $$
declare n int; mid uuid;
begin
  select count(*), min(member_id::text)::uuid into n, mid
    from public.pilot_member where not is_synthetic and (name ilike 'anne' or name ilike 'anne %');
  if n = 1 then
    insert into public.member_style_influence (member_id, influence_id, source)
      select mid, influence_id, 'application' from public.style_influence where slug = 'gillian-anderson'
      on conflict do nothing;
  end if;
end $$;
