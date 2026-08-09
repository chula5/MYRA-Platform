-- 0023_shopify_sync.sql
-- Part 2 of the affiliate infrastructure: Shopify app data plumbing.
--
--   webhook_delivery    — one row per webhook received. The UNIQUE delivery id
--                         is the idempotency key (Shopify retries aggressively;
--                         duplicate commission events would be a serious bug).
--                         Doubles as the Part 7 webhook log + replay source.
--   shopify_raw_payload — raw JSON exactly as Shopify sent it (products, orders,
--                         webhooks), so we can re-parse without re-fetching.
--
-- Also: per-item Shopify sync fields (inventory mapping for near-real-time
-- unique-stock updates), and merchant webhook/catalogue sync state.

create table if not exists public.webhook_delivery (
  delivery_id   text primary key,          -- X-Shopify-Webhook-Id header
  topic         text not null,
  shop_domain   text not null,
  merchant_id   uuid references public.merchant(merchant_id),
  hmac_valid    boolean not null,
  status        text not null default 'received'
                  check (status in ('received', 'processed', 'failed', 'skipped')),
  error         text,
  payload_id    uuid,                      -- shopify_raw_payload.payload_id
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

create index if not exists webhook_delivery_topic_idx on public.webhook_delivery (topic, received_at desc);
create index if not exists webhook_delivery_merchant_idx on public.webhook_delivery (merchant_id, received_at desc);
create index if not exists webhook_delivery_status_idx on public.webhook_delivery (status);

alter table public.webhook_delivery enable row level security;

create table if not exists public.shopify_raw_payload (
  payload_id   uuid primary key default gen_random_uuid(),
  merchant_id  uuid references public.merchant(merchant_id),
  kind         text not null,              -- 'product' | 'order' | 'webhook:<topic>'
  shopify_id   text,                       -- gid or numeric id when known
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);

create index if not exists shopify_raw_payload_kind_idx on public.shopify_raw_payload (merchant_id, kind, received_at desc);
create index if not exists shopify_raw_payload_shopify_id_idx on public.shopify_raw_payload (shopify_id);

alter table public.shopify_raw_payload enable row level security;

-- ── Item: Shopify sync fields ───────────────────────────────────────────────
-- shopify_inventory_item_id is how inventory_levels/update webhooks (which only
-- carry inventory_item_id) map back to our item for the unique-stock fast path.
alter table public.item add column if not exists shopify_inventory_item_id text;
alter table public.item add column if not exists shopify_handle text;
alter table public.item add column if not exists shopify_synced_at timestamptz;

create index if not exists item_shopify_inventory_idx on public.item (shopify_inventory_item_id);
create index if not exists item_shopify_product_idx on public.item (shopify_product_id);

-- ── Merchant: connection/sync state ─────────────────────────────────────────
alter table public.merchant add column if not exists installed_at timestamptz;
alter table public.merchant add column if not exists webhooks_registered_at timestamptz;
alter table public.merchant add column if not exists catalogue_synced_at timestamptz;

-- Pre-link J'amemme's merchant row to their store so the OAuth install attaches
-- the token to the SAME merchant the existing 35 items already point at
-- (matching on shop_domain is exact; name matching across "J'amemme" spellings
-- is not). Idempotent; no-op if already set.
update public.merchant
set shop_domain = 'jamemme2.myshopify.com'
where name = 'J''amemme' and shop_domain is null;
