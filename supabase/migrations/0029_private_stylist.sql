-- 0029_private_stylist.sql
-- PRIVATE STYLIST pilot — one house, three rooms, soft weighting per member.
--
-- Entirely self-contained: these tables never touch the live taste tables
-- (taste_event / user_taste_profile) or the public feed. Admin-only surface.
--
-- Contamination rule: rows flagged is_synthetic are dry-run plumbing tests.
-- They must never feed room-weight recomputation for real members, any taste
-- vector, or any future training data. Real member recomputes filter
-- is_synthetic = false at every read.

-- ── Members ─────────────────────────────────────────────────────────────────
create table if not exists public.pilot_member (
  member_id       uuid primary key default gen_random_uuid(),
  name            text not null,
  is_synthetic    boolean not null default false,
  -- ranked brand picks: [{ "name": "ME+EM", "rank": 1, "inferred_why": "sharp line without corporate stiffness" }]
  brands          jsonb not null default '[]'::jsonb,
  -- brands that are taste signal / wardrobe only — NEVER recommended (Zara rule: input, never output)
  brands_input_only text[] not null default '{}',
  -- { "tailored": 0.55, "romantic": 0.15, "ease": 0.30 } — always sums to 1
  room_weights    jsonb not null default '{"tailored":0.34,"romantic":0.33,"ease":0.33}'::jsonb,
  -- occasion picker (§4a): { "work_standard": "never", "casual_day": "most days", ... }
  occasions       jsonb not null default '{}'::jsonb,
  -- null unless a work row > never: 'suited_corporate' | 'smart_unwritten' | 'creative'
  work_dress_code text check (work_dress_code in ('suited_corporate', 'smart_unwritten', 'creative')),
  -- { "top": "M", "bottom": "28", "shoe": "39", "dress": "10" }
  sizes           jsonb not null default '{}'::jsonb,
  -- per-category ceilings in GBP: { "coat": 450, "dress": 300, "top": 150 }
  budget_ceiling  jsonb not null default '{}'::jsonb,
  never_wears     text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.pilot_member enable row level security;

-- ── Known upcoming events (drive anticipation moves) ────────────────────────
create table if not exists public.pilot_known_event (
  event_id    uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  label       text not null,           -- "Greece holiday"
  event_date  text not null,           -- "2026-09" or "2026-09-14" — month precision allowed
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.pilot_known_event enable row level security;

-- ── Wardrobe (owned pieces — style around these; Zara allowed here) ─────────
create table if not exists public.pilot_wardrobe_item (
  wardrobe_id uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  label       text not null,           -- "Zara wide-leg trousers"
  brand       text,
  item_type   text,
  colour      text,
  image_url   text,
  notes       text,
  created_at  timestamptz not null default now()
);
alter table public.pilot_wardrobe_item enable row level security;

-- ── Deliveries (one per request or anticipation move) ───────────────────────
create table if not exists public.pilot_delivery (
  delivery_id       uuid primary key default gen_random_uuid(),
  member_id         uuid not null references public.pilot_member(member_id) on delete cascade,
  trigger           text not null default 'request' check (trigger in ('request', 'anticipation')),
  request_text      text,              -- her words, or the anticipation framing
  occasion          text not null check (occasion in
                      ('work_standard','work_elevated','casual_day','dinner_drinks','event','travel')),
  -- effective_weights = normalise(room_weights × occasion_tilt, clamped by formality floor)
  -- snapshotted at creation so the delivery records what the maths said at the time
  effective_weights jsonb not null default '{}'::jsonb,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'responded')),
  is_synthetic      boolean not null default false,
  dry_run_brief     text,              -- which §4b script line produced this, if dry-run
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
alter table public.pilot_delivery enable row level security;

-- ── Looks (3 per delivery; items held as jsonb at pilot scale) ──────────────
create table if not exists public.pilot_look (
  look_id         uuid primary key default gen_random_uuid(),
  delivery_id     uuid not null references public.pilot_delivery(delivery_id) on delete cascade,
  position        int not null default 1,
  -- { "tailored": 0.7, "romantic": 0.0, "ease": 0.3 } — every look names its room mix
  room_mix        jsonb not null default '{}'::jsonb,
  -- [{ "brand", "product_name", "price_gbp", "url", "owned", "size", "in_stock", "stock_checked_at" }]
  items           jsonb not null default '[]'::jsonb,
  image_url       text,
  notes           text,
  response        text check (response in ('yes', 'no')),
  response_reason text check (response_reason in
                    ('not_my_style','wrong_occasion','too_expensive','owned_similar',
                     'fit_concern','colour','other')),
  responded_at    timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.pilot_look enable row level security;

-- ── Activity log (clicks, purchases, returns, stock drift) ──────────────────
create table if not exists public.pilot_activity (
  activity_id uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  delivery_id uuid references public.pilot_delivery(delivery_id) on delete set null,
  look_id     uuid references public.pilot_look(look_id) on delete set null,
  type        text not null check (type in
                ('click_out','purchase','save','unprompted_return','stock_moved','note')),
  detail      text,
  is_synthetic boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.pilot_activity enable row level security;

-- ── Room-weight snapshots (intake vs week 4 is the exit artefact spine) ─────
create table if not exists public.pilot_weight_snapshot (
  snapshot_id  uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.pilot_member(member_id) on delete cascade,
  room_weights jsonb not null,
  source       text not null default 'weekly' check (source in ('intake', 'weekly', 'manual')),
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.pilot_weight_snapshot enable row level security;

create index if not exists idx_pilot_delivery_member on public.pilot_delivery(member_id, created_at desc);
create index if not exists idx_pilot_look_delivery on public.pilot_look(delivery_id, position);
create index if not exists idx_pilot_activity_member on public.pilot_activity(member_id, created_at desc);
create index if not exists idx_pilot_snapshot_member on public.pilot_weight_snapshot(member_id, created_at);

-- No anon/authenticated policies on purpose: RLS on with zero policies means
-- only the service-role admin client can touch these tables. Nothing here is
-- reachable from the public site.
