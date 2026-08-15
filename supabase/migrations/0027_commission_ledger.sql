-- 0027_commission_ledger.sql
-- Part 3: the commission ledger — THE single source of truth for what a
-- merchant owes MYRA. Parts 4/5/7 read from these tables; nothing recalculates
-- commission independently (two places that can disagree = a lost partner).
--
-- State machine:   pending → approved → payable → paid
--                     ↓         ↓
--                   void     returned
--
--   pending   order created, inside the merchant's return window
--   approved  return window closed, commission is real
--   payable   swept into an invoice / drawn against balance (Part 5)
--   paid      settled
--   void      order cancelled before approval
--   returned  refunded after approval — reversed cleanly, never deleted
--
-- Money rules: amounts are stored in BOTH the sale currency and GBP, with the
-- FX rate FIXED at accrual time (never recalculated at settlement). Rate
-- applied is snapshotted onto the row. History is append-only via
-- commission_event; commission rows transition status but amounts never mutate
-- after approval — corrections are events + reversals.

-- ── Commission terms (versioned; Part 6 acceptance flow) ────────────────────
create table if not exists public.commission_terms (
  terms_id        uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references public.merchant(merchant_id),
  version         integer not null,
  base_rate       numeric not null check (base_rate > 0 and base_rate < 1),
  -- Optional promotional introductory rate with automatic expiry.
  intro_rate      numeric check (intro_rate > 0 and intro_rate < 1),
  intro_expires_at timestamptz,
  -- Optional volume tier: above the monthly threshold, tier_rate applies.
  tier_threshold_gbp numeric,
  tier_rate       numeric check (tier_rate > 0 and tier_rate < 1),
  terms_text      text,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  accepted_by     uuid,
  unique (merchant_id, version)
);
alter table public.commission_terms enable row level security;

-- ── The ledger ──────────────────────────────────────────────────────────────
create table if not exists public.commission (
  commission_id     uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchant(merchant_id),
  -- Shopify order identity. UNIQUE per merchant: a retried webhook or a
  -- re-processed order can never create a duplicate commission row.
  shopify_order_id  text not null,
  order_number      text,
  order_created_at  timestamptz,
  -- Attribution
  click_id          uuid references public.click(click_id),
  attribution       text not null default 'none'
                      check (attribution in ('landing_site', 'journey', 'manual', 'none')),
  attribution_note  text,
  -- Money (sale currency + GBP fixed at accrual)
  order_value       numeric not null default 0,   -- commissionable base (subtotal)
  currency          text not null default 'GBP',
  fx_rate_to_gbp    numeric not null default 1,
  order_value_gbp   numeric not null default 0,
  rate_applied      numeric not null,
  commission_gbp    numeric not null default 0,
  terms_version     integer,
  -- State
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'payable', 'paid', 'void', 'returned')),
  return_window_ends_at timestamptz not null,
  approved_at       timestamptz,
  settled_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (merchant_id, shopify_order_id)
);
create index if not exists commission_merchant_status_idx on public.commission (merchant_id, status, created_at desc);
create index if not exists commission_window_idx on public.commission (status, return_window_ends_at);
alter table public.commission enable row level security;

-- Append-only transition log: every state change, who/what did it, and why.
create table if not exists public.commission_event (
  event_id      uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commission(commission_id),
  from_status   text,
  to_status     text not null,
  actor         text not null default 'system',   -- 'system' | admin user id
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists commission_event_commission_idx on public.commission_event (commission_id, created_at);
alter table public.commission_event enable row level security;

-- ── Admin audit log (Part 7: every mutating admin action) ───────────────────
create table if not exists public.admin_audit_log (
  audit_id    uuid primary key default gen_random_uuid(),
  actor       text not null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  reason      text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

-- ── Merchant: default rate when no accepted terms exist ─────────────────────
alter table public.merchant add column if not exists default_commission_rate numeric not null default 0.15;

-- Seed J'amemme's founding-partner terms: 20% introductory for six months from
-- today, 15% base thereafter. PLACEHOLDER COMMERCIAL NUMBERS — editable in
-- /admin/merchants before anything accrues against them.
insert into public.commission_terms (merchant_id, version, base_rate, intro_rate, intro_expires_at, terms_text)
select m.merchant_id, 1, 0.15, 0.20, now() + interval '6 months',
       'Founding partner: 20% commission on MYRA-attributed sales for 6 months, 15% thereafter. 30-day return window.'
from public.merchant m
where m.shop_domain = 'jamemme2.myshopify.com'
  and not exists (select 1 from public.commission_terms t where t.merchant_id = m.merchant_id);
