-- MEMBER AVATAR — her own body, dressed in her own wardrobe (plan of 2026-11-09).
--
--   member_avatar  one avatar per member: her photos (private bucket), the portrait she chose,
--                  the body, and the relaxed base every layer is shot on.
--   avatar_way     the ways-to-wear catalogue Chloe curates: text recipes by item type, free to add.
--   avatar_layer   one shot of one piece in one way on one avatar, cut into a see-through layer.
--   avatar_look    an outfit she built or opened, and its finished photograph.
--   avatar_job     the work queue, the same shape as styled_way_job (heartbeat from 0114).
--
-- Service-role only: /me actions resolve the member on the server and pass her id.

-- ── Private storage for her photos ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('avatar-photos', 'avatar-photos', false)
  on conflict (id) do nothing;

-- ── Her avatar ──────────────────────────────────────────────────────────────
create table if not exists public.member_avatar (
  avatar_id     uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  -- collecting → portrait (making) → choose (she picks a face) → body (making) → review (she approves) → ready
  status        text not null default 'collecting'
                check (status in ('collecting', 'portrait', 'choose', 'body', 'review', 'ready', 'failed', 'retired')),
  photos        jsonb not null default '[]'::jsonb,   -- [{ path, kind: 'face' | 'full' }]
  height_cm     int,
  portrait_urls jsonb not null default '[]'::jsonb,   -- the candidates she chose between
  portrait_url  text,                                 -- the face, fixed from here on
  body_url      text,                                 -- A-pose body with her head on
  base_url      text,                                 -- relaxed stance: every layer is shot on this
  width         int,
  height        int,
  consent_text  text,
  consent_at    timestamptz,
  approved_at   timestamptz,
  attempts      int not null default 0,
  error         text,
  cost_gbp      numeric(8,4) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.member_avatar enable row level security;
create unique index if not exists uq_member_avatar_live on public.member_avatar (member_id) where status <> 'retired';
create index if not exists idx_member_avatar_member on public.member_avatar (member_id, created_at desc);

-- ── The ways catalogue ──────────────────────────────────────────────────────
create table if not exists public.avatar_way (
  way_key       text primary key,                 -- 'shirt.tucked', 'scarf.belt'
  item_types    text[] not null,                  -- item_type values this way applies to
  label         text not null,
  shoot_prompt  text not null,                    -- how the piece is worn, in a sentence
  mask_prompt   text not null,                    -- what to paint magenta in the mark-up pass
  z             int not null default 5,           -- stacking order, low first
  needs_way     text,                             -- only while this way is on (e.g. 'blazer.worn')
  cinches       text,                             -- swaps this piece type to its cinched state ('blazer')
  is_default    boolean not null default false,   -- the way shot first when the piece arrives
  default_rule  jsonb,                            -- when MYRA picks this way by itself
  active        boolean not null default true,
  sort          int not null default 100
);
alter table public.avatar_way enable row level security;

-- ── Layers ──────────────────────────────────────────────────────────────────
create table if not exists public.avatar_layer (
  layer_id      uuid primary key default gen_random_uuid(),
  avatar_id     uuid not null references public.member_avatar(avatar_id) on delete cascade,
  item_id       uuid not null references public.item(item_id) on delete cascade,
  way_key       text not null references public.avatar_way(way_key),
  base_way_key  text,                             -- a dependent way is cut against this way's shot
  status        text not null default 'queued' check (status in ('queued', 'shooting', 'masking', 'ready', 'failed')),
  shot_url      text,
  mask_url      text,
  layer_url     text,
  clip_url      text,                             -- outerwear: where tops underneath may show
  width         int,
  height        int,
  attempts      int not null default 0,
  error         text,
  cost_gbp      numeric(8,4) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (avatar_id, item_id, way_key)
);
alter table public.avatar_layer enable row level security;
create index if not exists idx_avatar_layer_item on public.avatar_layer (item_id);   -- item deletes stay fast (0096 lesson)
create index if not exists idx_avatar_layer_avatar on public.avatar_layer (avatar_id, status);

-- ── Looks ───────────────────────────────────────────────────────────────────
create table if not exists public.avatar_look (
  look_id       uuid primary key default gen_random_uuid(),
  avatar_id     uuid not null references public.member_avatar(avatar_id) on delete cascade,
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  items         jsonb not null default '[]'::jsonb,  -- [{ item_id, way_key }]
  finish_url    text,
  finish_status text check (finish_status in ('queued', 'rendering', 'done', 'failed')),
  source        text not null default 'built' check (source in ('built', 'studio', 'styled_way', 'saved')),
  source_id     text,
  created_at    timestamptz not null default now()
);
alter table public.avatar_look enable row level security;
create index if not exists idx_avatar_look_member on public.avatar_look (member_id, created_at desc);

-- ── Jobs ────────────────────────────────────────────────────────────────────
create table if not exists public.avatar_job (
  job_id        uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('portrait', 'body', 'layer', 'finish')),
  ref_id        uuid not null,                    -- avatar_id, layer_id or look_id
  member_id     uuid not null,
  priority      int not null default 2,           -- 1 = she is waiting, 2 = warm-up
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts      int not null default 0,
  heartbeat_at  timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  cost_gbp      numeric(8,4) not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.avatar_job enable row level security;
create index if not exists idx_avatar_job_queue on public.avatar_job (status, priority, created_at);
create unique index if not exists uq_avatar_job_open on public.avatar_job (kind, ref_id) where status in ('queued', 'running');

-- ── The first catalogue: the ways proven in the sandbox (2026-11-06 to 09) ──
insert into public.avatar_way (way_key, item_types, label, shoot_prompt, mask_prompt, z, needs_way, cinches, is_default, default_rule, sort) values
  ('top.untucked', array['shirt','blouse','knitwear','top','t_shirt','cami','vest'], 'Untucked',
    'she is wearing the {piece} from image 2, hanging loose and untucked so its hem falls over the top of the grey shorts',
    'the {piece}, including its sleeves, cuffs, collar and hem', 4, null, null, true, '{"when":"no_bottom_or_skirt"}', 10),
  ('top.tucked', array['shirt','blouse','knitwear','top','t_shirt','cami','vest'], 'Tucked',
    'she is wearing the {piece} from image 2, neatly tucked all the way into the waistband of the grey shorts, so no hem is visible below the waistband',
    'the {piece}, including its sleeves, cuffs and collar', 2, null, null, false, '{"when":"trousers_on"}', 11),
  ('bottom.worn', array['trousers','jeans','shorts','skirt','culottes'], 'Worn',
    'she is wearing the {piece} from image 2 at her natural waist, with the grey tank top tucked into it',
    'the {piece}, from waistband to hem', 3, null, null, true, null, 20),
  ('dress.worn', array['mini_dress','midi_dress','maxi_dress','shirt_dress','dress','jumpsuit','playsuit'], 'Worn',
    'she is wearing the {piece} from image 2 over the grey tank top and shorts, which stay underneath wherever they are not covered',
    'the {piece}, from neckline to hem including sleeves and straps', 4, null, null, true, null, 30),
  ('outer.worn', array['blazer','jacket','coat','cape','gilet','cardigan'], 'Worn',
    'she is wearing the {piece} from image 2 properly with her arms through the sleeves, worn open and unbuttoned over what she has on',
    'the {piece}, including its sleeves, lapels, collar and pocket flaps', 8, null, null, true, null, 40),
  ('scarf.neck', array['scarf','shawl','stole','bandana'], 'Neck',
    'the {piece} from image 2 is rolled and tied loosely around her neck, knotted at the front with the two ends hanging down over her chest',
    'the {piece} tied at her neck, including its hanging ends', 6, null, null, true, null, 50),
  ('scarf.shoulders', array['scarf','shawl','stole','bandana'], 'Shoulders',
    'the {piece} from image 2 is folded into a triangle and draped over her shoulders like a small shawl, tied in a knot at the front of her chest',
    'the {piece} draped over her shoulders, including the knot and ends', 6, null, null, false, null, 51),
  ('scarf.hips', array['scarf','shawl','stole','bandana'], 'Hips',
    'the {piece} from image 2 is folded into a triangle and tied around her hips as a wrap over what she has on, knotted at her right hip with the point of the triangle hanging down over her left thigh',
    'the {piece} tied around her hips, including the knot and the hanging point', 5, null, null, false, null, 52),
  ('scarf.belt', array['scarf','shawl','stole','bandana'], 'Belt over jacket',
    'the {piece} from image 2 is rolled into a band and tied around her waist OVER the open jacket like a belt, cinching the jacket closed at the waist, knotted at the front just off-centre with the two ends hanging down over one hip',
    'the {piece} tied as a belt, including both of its hanging ends', 9, 'outer.worn', 'outer', false, null, 53),
  ('shoes.worn', array['boot','heel','flat','sandal','trainer','sneaker','loafer','mule','shoe'], 'Worn',
    'she is wearing the {piece} from image 2 on both feet, standing in the same place',
    'both shoes AND both of her feet and ankles, from the lower shin down to the floor', 1, null, null, true, null, 60)
on conflict (way_key) do nothing;
