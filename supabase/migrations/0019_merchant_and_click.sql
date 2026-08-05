-- 0019_merchant_and_click.sql
-- Part 1 of the affiliate infrastructure: the Merchant entity, item linkage,
-- and the outbound Click log with taste-vector snapshots.
--
-- MERCHANT vs BRAND (critical distinction):
--   brand_id    = the label on the garment  → drives taste scoring
--   merchant_id = the entity that owes MYRA commission → drives the ledger,
--                 Shopify connection state and click routing
-- A vintage seller can list Prada (brand) while being the merchant themselves.
--
-- link_mode:
--   'redirect' — outbound clicks route through /go/[click_id] (server 302).
--                Safe for Rakuten (deep links are composed server-side) and
--                direct/manual merchants (params appended to the product URL).
--   'beacon'   — the visible link stays EXACTLY as today and the click is
--                logged via a fire-and-forget action. Required for Awin
--                Convert-a-Link merchants (Da Luna): Awin's MasterTag rewrites
--                the link client-side in the browser, so a server redirect
--                would break their attribution.

-- ── Merchant ────────────────────────────────────────────────────────────────
create table if not exists public.merchant (
  merchant_id             uuid primary key default gen_random_uuid(),
  name                    text not null,
  type                    text not null default 'manual'
                            check (type in ('shopify', 'manual', 'network')),
  status                  text not null default 'active'
                            check (status in ('active', 'paused', 'uninstalled')),
  link_mode               text not null default 'redirect'
                            check (link_mode in ('redirect', 'beacon')),

  -- Shopify connection (null until the app is installed)
  shop_domain             text unique,
  access_token_encrypted  text,
  granted_scopes          text,
  attribution_scope_verified boolean not null default false,

  -- Outbound tracking params for direct/manual merchants. '{click_id}' is
  -- substituted at redirect time. NULL = append nothing (network merchants —
  -- their own deep-link/tag does the tracking and must not be disturbed).
  tracking_param_template text,

  -- Commercial config (used from Part 3 onward; harmless now)
  return_window_days      integer not null default 30,
  billing_model           text not null default 'prefunded'
                            check (billing_model in ('prefunded', 'invoiced')),
  credit_limit_gbp        numeric,
  vat_number              text,
  country_code            text,
  reverse_charge          boolean not null default false,

  notes                   text,
  created_at              timestamptz not null default now(),
  uninstalled_at          timestamptz
);

alter table public.merchant enable row level security;

-- ── Item linkage ────────────────────────────────────────────────────────────
alter table public.item add column if not exists merchant_id uuid references public.merchant(merchant_id);
alter table public.item add column if not exists stock_type text not null default 'replenishable'
  check (stock_type in ('replenishable', 'unique'));
alter table public.item add column if not exists price_gbp numeric;          -- native GBP (Shopify Markets), original stays in price/currency
alter table public.item add column if not exists shopify_product_id text;
alter table public.item add column if not exists shopify_variant_id text;
alter table public.item add column if not exists available boolean not null default true;

create index if not exists item_merchant_idx on public.item (merchant_id);

-- ── Click log ───────────────────────────────────────────────────────────────
-- Append-only. taste_vector_snapshot is the user's 34-dim vector AT CLICK TIME
-- (null for logged-out users) — not recoverable retroactively.
create table if not exists public.click (
  click_id               uuid primary key,
  user_id                uuid,
  session_id             text,
  item_id                uuid not null references public.item(item_id),
  outfit_id              uuid references public.outfit(outfit_id),
  merchant_id            uuid references public.merchant(merchant_id),  -- null: no commercial relationship yet
  destination_url        text not null,
  taste_vector_snapshot  vector(34),
  device                 text,
  referrer               text,
  is_bot                 boolean not null default false,
  created_at             timestamptz not null default now()
);

create index if not exists click_merchant_created_idx on public.click (merchant_id, created_at desc);
create index if not exists click_item_idx on public.click (item_id);
create index if not exists click_user_idx on public.click (user_id);
create index if not exists click_created_idx on public.click (created_at desc);

alter table public.click enable row level security;

-- ── Seed merchants for the existing rails ───────────────────────────────────
-- Rakuten deep-link merchants → redirect mode (links composed server-side,
-- byte-identical to today's affiliateUrl() output).
insert into public.merchant (name, type, link_mode)
select v.name, 'network', 'redirect'
from (values ('Isabel Marant'), ('Twinset'), ('Diesel'), ('DeMellier London')) as v(name)
where not exists (select 1 from public.merchant m where m.name = v.name);

-- Awin Convert-a-Link (client-side MasterTag) → beacon mode. Do NOT redirect.
insert into public.merchant (name, type, link_mode)
select 'Da Luna', 'network', 'beacon'
where not exists (select 1 from public.merchant m where m.name = 'Da Luna');

-- J'amemme — first direct partner, manual phase (plain product URLs + our params).
insert into public.merchant (name, type, link_mode, tracking_param_template)
select 'J''amemme', 'manual', 'redirect', 'utm_source=myra&utm_medium=affiliate&myra_click={click_id}'
where not exists (select 1 from public.merchant m where m.name = 'J''amemme');

-- ── Backfill item.merchant_id by brand name ─────────────────────────────────
-- Only the six known commercial relationships; every other item stays null
-- (raw links, no commission routing) until a merchant is attached.
update public.item i
set merchant_id = m.merchant_id
from public.brand b, public.merchant m
where i.brand_id = b.brand_id
  and i.merchant_id is null
  and (
    (b.name ~* 'isabel\s*marant'  and m.name = 'Isabel Marant') or
    (b.name ~* 'twin\s*set'       and m.name = 'Twinset') or
    (b.name ~* '^diesel$'         and m.name = 'Diesel') or
    (b.name ~* 'de\s*mellier'     and m.name = 'DeMellier London') or
    (b.name ~* 'da\s*luna'        and m.name = 'Da Luna') or
    (b.name ~* 'j.?amemme'        and m.name = 'J''amemme')
  );
