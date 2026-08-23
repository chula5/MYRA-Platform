-- 0048_second_hand_inventory.sql
-- SECOND-HAND / ONE-OF-ONE INVENTORY, SIZE-AWARE AVAILABILITY, SAVED-OUTFIT RESCUE
--
-- The whole feature turns on one distinction:
--
--   replenishable  a retail item. Sells out, restocks. Worth ranking down,
--                  never worth deleting. The look keeps its styling value.
--   unique         a one-of-one piece (SPRL, vintage). Quantity is always 1.
--                  When it sells it is GONE — status 'sold', never re-checked,
--                  never restored, excluded from the 30-day restock watch.
--
-- Everything below follows from that: size becomes a hard filter for unique
-- pieces (there is no point styling a size 14 coat for a size 8 client), and a
-- sold unique piece retires its live outfits while its SAVED outfits enter the
-- rescue flow rather than vanishing from anyone's list.

-- ── 1. ITEM CLASS ────────────────────────────────────────────────────────────
alter table public.item
  -- Per-item override; defaults are inherited from the merchant at ingest.
  add column if not exists stock_class text not null default 'replenishable'
    check (stock_class in ('replenishable', 'unique')),
  add column if not exists sold_at timestamptz,
  -- How we learned it sold: 'feed' | 'webhook' | 'poll' | 'manual'.
  add column if not exists sold_signal text,
  -- Risk-tiered polling (see §5). next_check_at is the scheduler's cursor.
  add column if not exists poll_tier text check (poll_tier in ('A', 'B', 'C')),
  add column if not exists risk_score numeric,
  add column if not exists next_check_at timestamptz,
  -- Second-hand merchandising: when the piece first went live, so the studio
  -- can flag ">14 days live, no click-outs".
  add column if not exists live_since timestamptz,
  -- The merchant's own id for this product, when a feed or webhook gives us
  -- one. Matching on retailer_url alone breaks the moment a store rewrites its
  -- handles, and a second-hand store rewrites handles constantly.
  add column if not exists external_id text;

create index if not exists item_stock_class_idx on public.item (stock_class);
create index if not exists item_next_check_idx  on public.item (next_check_at nulls first);
create index if not exists item_external_idx    on public.item (merchant_id, external_id) where external_id is not null;

-- item.status gains 'sold'. Same catalog-resolution dance as migration 0017:
-- the column may be an enum, a domain over an enum, or plain text.
do $$
declare tid oid;
begin
  select a.atttypid into tid
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'item' and a.attname = 'status'
    and a.attnum > 0 and not a.attisdropped;

  while exists (select 1 from pg_type where oid = tid and typtype = 'd') loop
    select typbasetype into tid from pg_type where oid = tid;
  end loop;

  if exists (select 1 from pg_type where oid = tid and typtype = 'e') then
    execute format('alter type %s add value if not exists %L', tid::regtype, 'sold');
  else
    execute 'alter table public.item drop constraint if exists item_status_check';
    execute $c$alter table public.item add constraint item_status_check check (status in (
      'draft', 'ready', 'live', 'archived', 'out_of_stock', 'sold'
    ))$c$;
  end if;
end $$;

-- outfit.status gains 'retired' — a pause that can never be lifted, because
-- the piece that made the look can never come back.
alter type outfit_status_enum add value if not exists 'retired';

alter table public.outfit
  add column if not exists retired_reason text,
  add column if not exists retired_at timestamptz;

-- ── 2. SOURCE TYPE (retailer / brand) ────────────────────────────────────────
-- merchant = the entity that sells it (SPRL Shop). brand = the label on the
-- garment (a vintage seller can list Prada). The merchant is authoritative for
-- source_type; the brand column is an override for own-label vintage houses.
alter table public.merchant
  add column if not exists source_type text not null default 'retail'
    check (source_type in ('retail', 'second_hand', 'vintage')),
  add column if not exists default_stock_class text not null default 'replenishable'
    check (default_stock_class in ('replenishable', 'unique')),
  -- Structured availability beats scraping — see §5. Feed pulled every 30 min,
  -- webhook gives an instant sold signal.
  add column if not exists feed_url text,
  add column if not exists feed_format text check (feed_format in ('shopify_json', 'google_rss', 'custom_json')),
  add column if not exists feed_checked_at timestamptz,
  add column if not exists feed_error text,
  add column if not exists webhook_secret text;

alter table public.brand
  add column if not exists source_type text
    check (source_type in ('retail', 'second_hand', 'vintage')),
  -- Per-category size offset in LADDER STEPS. -1 = runs large (a labelled UK 10
  -- behaves like a UK 8), +1 = runs small. Keys: tops | bottoms | outerwear |
  -- shoes | default. Set by hand in admin — nothing infers it.
  add column if not exists size_offset jsonb not null default '{}'::jsonb;

-- ── 3. SIZE AVAILABILITY ─────────────────────────────────────────────────────
-- One row per size a retailer lists. Both the retailer's ORIGINAL label (for
-- display — she recognises "IT 42", not "canonical 10") and the canonical value
-- (for matching) are stored, so a UK 10, EU 38 and IT 42 all resolve together.
--
-- Unique items carry exactly one row (enforced by the trigger below).
create table if not exists public.item_size_availability (
  item_id       uuid        not null references public.item(item_id) on delete cascade,
  -- The retailer's own string, verbatim: "UK 10", "IT 42", "M", "39".
  size_label    text        not null,
  size_system   text        not null default 'unknown'
    check (size_system in ('UK', 'EU', 'US', 'IT', 'FR', 'AU', 'alpha', 'shoe_UK', 'shoe_EU', 'shoe_US', 'waist', 'one_size', 'unknown')),
  -- Canonical scale per category. category is one of tops | bottoms |
  -- outerwear | shoes; value is the UK-ladder number (UK 10 → 10, shoe UK 5 →
  -- 5). NULL where the label can't be resolved — never treated as a mismatch.
  canonical_category text   check (canonical_category in ('tops', 'bottoms', 'outerwear', 'shoes')),
  canonical_value    numeric,
  -- Alpha sizes span more than one numeric size (an "M" is a 10 OR a 12
  -- depending on the brand), so the scalar above is the representative value
  -- and this array is every canonical value the label actually covers. Matching
  -- reads the array; display and reporting read the scalar.
  canonical_values   numeric[]   not null default '{}',
  in_stock      boolean     not null default true,
  stock_level   text        not null default 'unknown'
    check (stock_level in ('in_stock', 'low', 'sold_out', 'unknown')),
  last_checked  timestamptz not null default now(),
  primary key (item_id, size_label)
);

create index if not exists isa_item_idx      on public.item_size_availability (item_id);
create index if not exists isa_canonical_idx on public.item_size_availability (canonical_category, canonical_value) where in_stock;
alter table public.item_size_availability enable row level security;

-- A one-of-one has one size, by definition. Guard it in the database so no
-- ingest path can quietly create a "unique" item with four sizes.
create or replace function public.enforce_unique_item_single_size() returns trigger
language plpgsql as $$
declare cls text; n int;
begin
  select stock_class into cls from public.item where item_id = new.item_id;
  if cls <> 'unique' then return new; end if;
  select count(*) into n from public.item_size_availability
    where item_id = new.item_id and size_label <> new.size_label;
  if n > 0 then
    raise exception 'item % is unique (one-of-one) and already has a size row', new.item_id;
  end if;
  return new;
end $$;

drop trigger if exists isa_unique_single_size on public.item_size_availability;
create trigger isa_unique_single_size
  before insert or update on public.item_size_availability
  for each row execute function public.enforce_unique_item_single_size();

-- ── 4. USER SIZE PROFILE + SECOND-HAND CONSENT ───────────────────────────────
-- Canonical values per category plus the optional "I also wear" adjacent size —
-- many people are a 10 or a 12 depending on cut, and an adjacent size the user
-- listed herself is an ACCEPTABLE match, not a guess we made for her.
create table if not exists public.user_size_profile (
  user_id             uuid        primary key,
  tops                numeric,
  tops_adjacent       numeric,
  bottoms             numeric,
  bottoms_adjacent    numeric,
  outerwear           numeric,
  outerwear_adjacent  numeric,
  shoes               numeric,
  shoes_adjacent      numeric,
  -- "Would you like to be shown pre-loved and vintage pieces?" Default false:
  -- second-hand is opt-IN, and silence is not consent.
  accepts_second_hand boolean     not null default false,
  updated_at          timestamptz not null default now()
);
alter table public.user_size_profile enable row level security;

-- Private-stylist clients carry the same two facts on their member record.
alter table public.pilot_member
  add column if not exists size_profile jsonb not null default '{}'::jsonb,
  add column if not exists accepts_second_hand boolean not null default false;

-- ── 5. SAVED-ITEM STOCK SUBSCRIPTIONS + ALERTS ───────────────────────────────
-- Saving an item (or an outfit) subscribes her to stock events for those items,
-- SCOPED TO HER SIZE at subscribe time. We never alert on a size she doesn't
-- wear, so the sizes she cares about are frozen onto the subscription rather
-- than re-derived at send time.
create table if not exists public.stock_subscription (
  subscription_id uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null,
  item_id         uuid        not null references public.item(item_id) on delete cascade,
  -- The outfit the save came from, when it was an outfit save (rescue context).
  outfit_id       uuid,
  source          text        not null check (source in ('saved_item', 'saved_outfit', 'notify_me')),
  -- Canonical sizes to watch. Empty = watch item-level availability only
  -- (accessories, one-size, or a user with no size profile yet).
  watch_category  text        check (watch_category in ('tops', 'bottoms', 'outerwear', 'shoes')),
  watch_values    numeric[]   not null default '{}',
  active          boolean     not null default true,
  created_at      timestamptz not null default now(),
  unique (user_id, item_id, source)
);
create index if not exists stock_sub_item_idx on public.stock_subscription (item_id) where active;
create index if not exists stock_sub_user_idx on public.stock_subscription (user_id) where active;
alter table public.stock_subscription enable row level security;

-- One row per user-facing stock event. Rendered in-app on the saved list and
-- drained into a BATCHED daily email — never one email per event.
create table if not exists public.stock_alert (
  alert_id     uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null,
  item_id      uuid        not null references public.item(item_id) on delete cascade,
  outfit_id    uuid,
  kind         text        not null check (kind in (
                 'low_in_size', 'sold_out_in_size', 'back_in_size', 'unique_sold', 'restyled')),
  -- 'urgent' sends within the hour (unique or fast-moving low stock);
  -- 'batch' waits for the daily digest.
  priority     text        not null default 'batch' check (priority in ('urgent', 'batch')),
  size_label   text,
  -- Set when the user has dismissed / seen it in-app.
  seen_at      timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now(),
  -- One live alert of a kind per user per item — repeated sweeps must not spam.
  unique (user_id, item_id, kind)
);
create index if not exists stock_alert_user_idx    on public.stock_alert (user_id, created_at desc);
create index if not exists stock_alert_pending_idx on public.stock_alert (priority, delivered_at) where delivered_at is null;
alter table public.stock_alert enable row level security;

-- ── 6. SAVED-OUTFIT RESCUE ───────────────────────────────────────────────────
-- ONE canonical restyle per (outfit, sold item) — shared by every user who
-- saved that outfit. One sold item = one Higgsfield render, regardless of how
-- many people saved the look. Never render per user.
create table if not exists public.outfit_rescue (
  rescue_id        uuid        primary key default gen_random_uuid(),
  outfit_id        uuid        not null,
  sold_item_id     uuid        not null,
  slot             text        not null,
  -- The like-for-like replacement, or NULL when nothing passed the
  -- constitution (state 'queued_for_review' — no render, queued for Chloe).
  replacement_item_id uuid,
  similarity       numeric,
  state            text        not null default 'pending'
    check (state in ('pending', 'rendering', 'ready', 'queued_for_review', 'failed')),
  -- The cached restyled hero, shown to every saver of this outfit.
  restyled_image_url text,
  render_job_id    uuid,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (outfit_id, sold_item_id)
);
create index if not exists outfit_rescue_outfit_idx on public.outfit_rescue (outfit_id);
alter table public.outfit_rescue enable row level security;

-- The SECOND layer: 2-4 further alternatives for the slot, surfaced only when
-- she engages (taps the restyle, saves it, or taps the struck-through item).
-- Item cards + a composed item-group preview — no Higgsfield render, unless she
-- SAVES one, and then the render is cached here so the next user reuses it.
create table if not exists public.rescue_alternative (
  alternative_id uuid        primary key default gen_random_uuid(),
  rescue_id      uuid        not null references public.outfit_rescue(rescue_id) on delete cascade,
  item_id        uuid        not null,
  similarity     numeric,
  rank           int         not null default 0,
  -- Populated lazily: the first user to SAVE this alternative triggers one
  -- render; every later user choosing the same alternative reuses it.
  rendered_image_url text,
  render_job_id  uuid,
  created_at     timestamptz not null default now(),
  unique (rescue_id, item_id)
);
create index if not exists rescue_alt_rescue_idx on public.rescue_alternative (rescue_id, rank);
alter table public.rescue_alternative enable row level security;

-- Which restyle a given user chose, so her saved card is stable across visits.
create table if not exists public.rescue_choice (
  user_id        uuid        not null,
  rescue_id      uuid        not null references public.outfit_rescue(rescue_id) on delete cascade,
  alternative_id uuid        references public.rescue_alternative(alternative_id) on delete set null,
  engaged_at     timestamptz not null default now(),
  primary key (user_id, rescue_id)
);
alter table public.rescue_choice enable row level security;

-- ── 7. ADMIN OVERRIDE — deliberate out-of-size inclusion ─────────────────────
-- "Sized up on purpose — oversized fit." Without this the size gate would make
-- an intentional styling decision impossible to express.
alter table public.outfit_item
  add column if not exists size_override boolean not null default false,
  add column if not exists size_override_note text;

-- ── 8. SECOND-HAND MERCHANDISING ANALYTICS ───────────────────────────────────
-- Sale events, so the studio can report median time-to-sale and click-outs
-- before sale without reconstructing them from the audit log.
create table if not exists public.second_hand_sale (
  sale_id        uuid        primary key default gen_random_uuid(),
  item_id        uuid        not null,
  merchant_id    uuid,
  brand_id       uuid,
  listed_at      timestamptz,
  sold_at        timestamptz not null default now(),
  days_live      numeric,
  clickouts      int         not null default 0,
  saves          int         not null default 0,
  canonical_category text,
  canonical_value    numeric,
  created_at     timestamptz not null default now(),
  unique (item_id)
);
create index if not exists sh_sale_sold_idx on public.second_hand_sale (sold_at desc);
alter table public.second_hand_sale enable row level security;

-- ── 9. RENDER QUEUE — rescue renders join the ONE sequential queue ───────────
-- The rescue render must not go through a second, parallel renderer: the whole
-- point of render_job is that Higgsfield runs one job at a time. A rescue job
-- carries a rescue_id (and, for the engagement layer, an alternative_id) and
-- caches its result against that row instead of republishing the outfit — the
-- outfit itself is retired and stays retired.
alter table public.render_job
  add column if not exists rescue_id uuid,
  add column if not exists alternative_id uuid;

alter table public.render_job drop constraint if exists render_job_trigger_check;
alter table public.render_job add constraint render_job_trigger_check
  check (trigger in ('approval', 'stock_swap', 'restock_restore', 'manual', 'rescue', 'rescue_alternative'));

create index if not exists render_job_rescue_idx on public.render_job (rescue_id) where rescue_id is not null;

-- ── 10. FAST COMPOSITION ON INGEST ───────────────────────────────────────────
-- Second-hand stock is time-sensitive: a one-of-one that isn't styled is a
-- one-of-one that sells somewhere else. Approving one puts a styling set at the
-- FRONT of the composer queue rather than the back.
alter table public.composed_outfit
  -- 1 = ahead of normal composer work (second-hand / unique heroes), 2 = normal.
  add column if not exists priority int not null default 2;

create index if not exists composed_outfit_priority_idx
  on public.composed_outfit (status, priority, confidence desc);

-- ── 11. live_since, stamped wherever an item goes live ──────────────────────
-- Time-to-sale and the ">14 days live, no click-outs" flag both need to know
-- when a piece actually became shoppable. A trigger is the only place that
-- catches every path — ingest approval, the composer, a manual status change.
create or replace function public.stamp_item_live_since() returns trigger
language plpgsql as $$
begin
  if new.status = 'live' and new.live_since is null then
    new.live_since := now();
  end if;
  return new;
end $$;

drop trigger if exists item_stamp_live_since on public.item;
create trigger item_stamp_live_since
  before insert or update of status on public.item
  for each row execute function public.stamp_item_live_since();

-- Backfill: anything already live gets its earliest known date rather than now,
-- so existing stock doesn't all read as "listed today".
update public.item
set live_since = coalesce(live_since, stock_checked_at)
where status = 'live' and live_since is null;

-- ── 12. Private clients get their stock news inside the stylist delivery ─────
-- A private client should not receive a second, differently-voiced email from
-- the same brand on the same day. Her pending alerts are attached to the
-- delivery when it is sent, and marked delivered at that moment.
alter table public.pilot_delivery
  add column if not exists stock_alerts jsonb not null default '[]'::jsonb;
