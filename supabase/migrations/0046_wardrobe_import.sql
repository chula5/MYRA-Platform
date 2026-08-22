-- 0046: Wardrobe Import — owned items for the private stylist section.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Clients (and Chloe on their behalf) upload photos of clothes they already
-- own. Each photo is DETECTED (OpenAI vision → one record per garment), each
-- garment is CUT OUT (OpenAI image edit → product-style cutout on white, hosted
-- on Cloudinary), SCORED through the exact same vision scoring as retail items,
-- then REVIEWED. Nothing enters the wardrobe unreviewed: approved garments
-- become `item` rows with ownership = 'owned', visible only to their owner and
-- to admin, and the private-stylist composer styles NEW retail pieces WITH them.
--
-- Owned items live on the existing item table (not a parallel one) so the
-- composer, House Style Constitution, Higgsfield shoot and taste maths treat an
-- owned linen shirt exactly like a retail one. They are never status = 'live'
-- (the public feed reads live only), carry no retailer_url (so the stock
-- sentinel and /go outbound resolver skip them), and every shared-pool query
-- filters ownership = 'retail'.

-- ── Item: ownership ─────────────────────────────────────────────────────────
alter table public.item add column if not exists ownership text not null default 'retail'
  check (ownership in ('retail', 'owned'));
-- The owner. For pilot members this is pilot_member.member_id; for signed-in
-- clients it is auth.users.id — owner_kind says which (same convention as
-- user_persona.subject_kind, migration 0043). Null for retail.
alter table public.item add column if not exists owner_user_id uuid;
alter table public.item add column if not exists owner_kind text
  check (owner_kind in ('pilot_member', 'auth_user'));
alter table public.item add column if not exists source_photo_id uuid;
alter table public.item add column if not exists extraction_id uuid;
-- 0..1 — how sure the detector was that this garment is what it says it is
alter table public.item add column if not exists extraction_confidence numeric;
-- user-entered, GBP — keeps cost-per-wear maths running when price is null
alter table public.item add column if not exists estimated_value numeric;
-- { "owned_since": "2023", "fit_notes": "runs small", "favourite": true,
--   "brand_label": "Sézane" (brand as typed, when no brand row matched),
--   "low_confidence_dims": ["material_formality", ...], "notes": "..." }
alter table public.item add column if not exists owned_metadata jsonb not null default '{}'::jsonb;

-- Owned items have no retailer and may have no known brand / price.
alter table public.item alter column brand_id drop not null;
alter table public.item alter column retailer_url drop not null;

create index if not exists idx_item_owner on public.item (owner_user_id, ownership) where ownership = 'owned';
create index if not exists idx_item_source_photo on public.item (source_photo_id) where source_photo_id is not null;

-- ── Pilot member ↔ login ────────────────────────────────────────────────────
-- Optional bridge so a client who uploads her own wardrobe at /me/wardrobe has
-- it composed into HER pilot deliveries.
alter table public.pilot_member add column if not exists auth_user_id uuid;

-- ── Private storage for the originals ───────────────────────────────────────
-- Never public; served through short-lived signed URLs only.
insert into storage.buckets (id, name, public)
  values ('wardrobe-photos', 'wardrobe-photos', false)
  on conflict (id) do nothing;

-- ── Batches (one upload session; the unit of cost accounting) ───────────────
create table if not exists public.wardrobe_batch (
  batch_id       uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null,
  owner_kind     text not null check (owner_kind in ('pilot_member', 'auth_user')),
  created_by     text not null default 'admin' check (created_by in ('admin', 'client')),
  label          text,
  photo_count    int not null default 0,
  status         text not null default 'open' check (status in ('open', 'processing', 'done')),
  created_at     timestamptz not null default now()
);
alter table public.wardrobe_batch enable row level security;
create index if not exists idx_wardrobe_batch_owner on public.wardrobe_batch (owner_user_id, created_at desc);

-- ── Photos (the originals) ──────────────────────────────────────────────────
create table if not exists public.wardrobe_photo (
  photo_id       uuid primary key default gen_random_uuid(),
  batch_id       uuid references public.wardrobe_batch(batch_id) on delete set null,
  owner_user_id  uuid not null,
  owner_kind     text not null check (owner_kind in ('pilot_member', 'auth_user')),
  storage_path   text not null,          -- wardrobe-photos/<owner>/<photo>.png
  original_name  text,
  mime_type      text,
  width          int,
  height         int,
  bytes          int,
  status         text not null default 'uploaded'
                 check (status in ('uploaded', 'detecting', 'detected', 'no_garments', 'failed', 'deleted')),
  detected       jsonb,                  -- raw detector output, for audit
  garment_count  int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
alter table public.wardrobe_photo enable row level security;
create index if not exists idx_wardrobe_photo_owner on public.wardrobe_photo (owner_user_id, created_at desc);
create index if not exists idx_wardrobe_photo_batch on public.wardrobe_photo (batch_id);

-- item.source_photo_id → photo; deleting a photo discards its items.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_source_photo_fk') then
    alter table public.item add constraint item_source_photo_fk
      foreign key (source_photo_id) references public.wardrobe_photo(photo_id) on delete cascade;
  end if;
end $$;

-- ── Extractions (one per detected garment — THE review queue) ───────────────
create table if not exists public.wardrobe_extraction (
  extraction_id   uuid primary key default gen_random_uuid(),
  photo_id        uuid not null references public.wardrobe_photo(photo_id) on delete cascade,
  batch_id        uuid references public.wardrobe_batch(batch_id) on delete set null,
  owner_user_id   uuid not null,
  owner_kind      text not null check (owner_kind in ('pilot_member', 'auth_user')),
  position        int not null default 1,       -- order within the photo
  status          text not null default 'detected' check (status in
                    ('detected',          -- garment found, cutout not yet made
                     'cutout_queued', 'cutout_running',
                     'scoring',
                     'review',            -- cutout + scores ready — waiting on a human
                     'approved', 'discarded', 'failed')),
  -- Stage 1 — DETECT: what the vision model saw
  -- { category, item_type, colour_family, colour_hex, material_guess, pattern,
  --   silhouette, description, bounding_box:{x,y,width,height} (0-1000), confidence }
  detected        jsonb not null default '{}'::jsonb,
  crop_url        text,                         -- Cloudinary: padded crop of the garment
  -- Stage 2 — CUTOUT
  cutout_url      text,                         -- Cloudinary: product-style cutout on white
  cutout_attempts int not null default 0,
  regen_direction text,                         -- reviewer's note for the next regeneration
  -- Stage 3 — SCORE: the same AnalysedProduct shape analyseProductImage returns
  scores          jsonb,
  low_confidence_dims text[] not null default '{}',
  -- Stage 4 — REVIEW: reviewer edits, merged over detected + scores on approve
  edits           jsonb not null default '{}'::jsonb,
  item_id         uuid,                         -- set when approved into item
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);
alter table public.wardrobe_extraction enable row level security;
create index if not exists idx_wardrobe_extraction_owner_status on public.wardrobe_extraction (owner_user_id, status, created_at);
create index if not exists idx_wardrobe_extraction_photo on public.wardrobe_extraction (photo_id, position);

-- ── Job queue (rate-limited, sequential — like render_job) ──────────────────
-- A 12-photo upload must never fire 12 parallel image generations: the drainer
-- claims ONE job at a time. detect jobs go first (cheap, unblock review of
-- what was found), then extract/regenerate jobs FIFO.
create table if not exists public.wardrobe_job (
  job_id         uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('detect', 'extract', 'regenerate', 'rescore')),
  batch_id       uuid references public.wardrobe_batch(batch_id) on delete set null,
  photo_id       uuid references public.wardrobe_photo(photo_id) on delete cascade,
  extraction_id  uuid references public.wardrobe_extraction(extraction_id) on delete cascade,
  owner_user_id  uuid not null,
  priority       int not null default 2,
  status         text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts       int not null default 0,
  payload        jsonb not null default '{}'::jsonb,
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
alter table public.wardrobe_job enable row level security;
create index if not exists idx_wardrobe_job_pick on public.wardrobe_job (status, priority, created_at);

-- ── API spend log (unit economics of onboarding a wardrobe) ─────────────────
create table if not exists public.wardrobe_api_call (
  call_id        uuid primary key default gen_random_uuid(),
  batch_id       uuid references public.wardrobe_batch(batch_id) on delete set null,
  owner_user_id  uuid,
  stage          text not null check (stage in ('detect', 'cutout', 'score')),
  provider       text not null check (provider in ('openai', 'anthropic')),
  model          text not null,
  input_tokens   int,
  output_tokens  int,
  image_count    int not null default 0,
  cost_usd       numeric not null default 0,
  estimated      boolean not null default false,   -- true when the API returned no usage
  duration_ms    int,
  ok             boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.wardrobe_api_call enable row level security;
create index if not exists idx_wardrobe_api_call_batch on public.wardrobe_api_call (batch_id, created_at);

-- No anon/authenticated policies on purpose (same stance as 0029): RLS on with
-- zero policies means only the service-role admin client reaches these tables.
-- The client-facing /me/wardrobe surface goes through server actions that
-- scope every read/write by the signed-in user's id.
--
-- NOTE on `item`: this repo defines no RLS for item — visibility is enforced in
-- application code (status = 'live' on every public read; owned items are
-- never live). If you later enable RLS on item, add:
--   create policy "retail only for anon" on public.item for select to anon
--     using (ownership = 'retail');
