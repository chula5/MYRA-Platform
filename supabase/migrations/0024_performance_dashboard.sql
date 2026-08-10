-- 0024_performance_dashboard.sql
-- The measurement layer behind the admin performance dashboard:
--
--   commission_transaction — one network-agnostic row per affiliate sale,
--                            synced from Awin / Rakuten / CJ. Money in.
--   network_sync_log       — per-network sync state, so the dashboard can say
--                            "AWIN · SYNCED 12 MIN AGO" or surface the error.
--   ad_spend_daily         — one row per (platform, date, campaign). Money out.
--
-- Both sides are stored in GBP so spend → commission is a straight subtraction.
-- Every table is append/upsert-only and written through the service-role client.

-- ── Commission ledger ───────────────────────────────────────────────────────
-- external_id is the network's own transaction id; (network, external_id) is
-- the idempotency key, so re-syncing an overlapping window updates rather than
-- duplicates. Status follows the network's lifecycle, normalised to four values.
create table if not exists public.commission_transaction (
  id                uuid primary key default gen_random_uuid(),
  network           text not null check (network in ('awin', 'rakuten', 'cj')),
  external_id       text not null,

  -- Normalised lifecycle:
  --   pending   — recorded, inside the return window
  --   approved  — validated by the advertiser, payable
  --   paid      — money received
  --   declined  — cancelled / returned / rejected
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'paid', 'declined')),

  sale_amount_gbp   numeric not null default 0,   -- basket value
  commission_gbp    numeric not null default 0,   -- what MYRA earns

  advertiser_name   text,                          -- as named by the network
  merchant_id       uuid references public.merchant(merchant_id),

  -- Attribution back into MYRA. click_ref is whatever the network echoed in its
  -- sub-id / u1 / SID field — for our own links that is the click_id, which is
  -- resolved to click_id/item_id/outfit_id below when it matches.
  click_ref         text,
  click_id          uuid,
  item_id           uuid references public.item(item_id),
  outfit_id         uuid references public.outfit(outfit_id),

  occurred_at       timestamptz not null,          -- when the sale happened
  updated_at        timestamptz not null default now(),
  raw               jsonb not null default '{}',   -- the network payload, verbatim

  unique (network, external_id)
);

create index if not exists commission_tx_occurred_idx on public.commission_transaction (occurred_at desc);
create index if not exists commission_tx_network_idx  on public.commission_transaction (network, occurred_at desc);
create index if not exists commission_tx_status_idx   on public.commission_transaction (status);
create index if not exists commission_tx_click_idx    on public.commission_transaction (click_id);
create index if not exists commission_tx_item_idx     on public.commission_transaction (item_id);

alter table public.commission_transaction enable row level security;

-- ── Per-network sync state ──────────────────────────────────────────────────
-- One row per network. last_error is kept so a silently failing credential
-- shows up on the dashboard instead of looking like "no sales".
create table if not exists public.network_sync_log (
  network          text primary key check (network in ('awin', 'rakuten', 'cj', 'meta')),
  last_synced_at   timestamptz,
  last_status      text not null default 'never'
                     check (last_status in ('never', 'ok', 'error', 'not_configured')),
  last_error       text,
  rows_synced      integer not null default 0,
  window_start     timestamptz,
  window_end       timestamptz,
  updated_at       timestamptz not null default now()
);

insert into public.network_sync_log (network)
select v.n from (values ('awin'), ('rakuten'), ('cj'), ('meta')) as v(n)
on conflict (network) do nothing;

alter table public.network_sync_log enable row level security;

-- ── Ad spend ────────────────────────────────────────────────────────────────
-- Daily grain per campaign. campaign_id '(account)' is used for account-level
-- rows so the unique key always has a value. Spend is stored in GBP — the MYRA
-- ad account bills in GBP, so no conversion is applied.
create table if not exists public.ad_spend_daily (
  id             uuid primary key default gen_random_uuid(),
  platform       text not null default 'meta' check (platform in ('meta', 'tiktok', 'google', 'other')),
  spend_date     date not null,
  campaign_id    text not null default '(account)',
  campaign_name  text,

  spend_gbp      numeric not null default 0,
  impressions    bigint  not null default 0,
  clicks         bigint  not null default 0,
  reach          bigint  not null default 0,
  -- Platform-attributed results (Meta's own conversion count). MYRA's first-party
  -- conversion numbers come from signups/clicks in Supabase, not from here.
  conversions    numeric not null default 0,

  synced_at      timestamptz not null default now(),
  raw            jsonb not null default '{}',

  unique (platform, spend_date, campaign_id)
);

create index if not exists ad_spend_date_idx on public.ad_spend_daily (spend_date desc);
create index if not exists ad_spend_platform_date_idx on public.ad_spend_daily (platform, spend_date desc);

alter table public.ad_spend_daily enable row level security;
