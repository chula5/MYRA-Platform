-- 0028_partners_billing_onboarding.sql
-- Parts 4–6: brand users + invites (4), balance/invoices (5), applications (6).

-- ── Part 4: brand users, tenancy, invites ───────────────────────────────────
-- Brand users are Supabase auth users MAPPED here. A shopper has no row; a
-- brand user's row scopes everything they can see to one merchant_id.
create table if not exists public.merchant_user (
  user_id     uuid not null,
  merchant_id uuid not null references public.merchant(merchant_id),
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (user_id, merchant_id)
);
alter table public.merchant_user enable row level security;

create table if not exists public.merchant_invite (
  invite_id   uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchant(merchant_id),
  email       text not null,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  token_hash  text not null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
alter table public.merchant_invite enable row level security;

-- Row-level security: the DEFENCE IN DEPTH the spec demands. Brand users read
-- their own merchant's rows through the user-scoped client; these policies are
-- what makes cross-tenant reads impossible even if app code has a bug.
-- (Consumer shoppers have no merchant_user row, so these grant them nothing.)
do $$ begin
  create policy merchant_user_self on public.merchant_user
    for select to authenticated using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy merchant_partner_read on public.merchant
    for select to authenticated using (
      exists (select 1 from public.merchant_user mu where mu.user_id = auth.uid() and mu.merchant_id = merchant.merchant_id)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy commission_partner_read on public.commission
    for select to authenticated using (
      exists (select 1 from public.merchant_user mu where mu.user_id = auth.uid() and mu.merchant_id = commission.merchant_id)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy terms_partner_read on public.commission_terms
    for select to authenticated using (
      exists (select 1 from public.merchant_user mu where mu.user_id = auth.uid() and mu.merchant_id = commission_terms.merchant_id)
    );
exception when duplicate_object then null; end $$;

-- ── Part 5: money movement ──────────────────────────────────────────────────
-- APPEND-ONLY. Balance = SUM(amount_gbp); there is deliberately no mutable
-- balance column anywhere. Positive = credit (top-up), negative = draw-down.
create table if not exists public.balance_entry (
  entry_id     uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchant(merchant_id),
  entry_type   text not null check (entry_type in ('topup', 'commission_draw', 'refund', 'adjustment', 'invoice_payment', 'reversal')),
  amount_gbp   numeric not null,
  commission_id uuid references public.commission(commission_id),
  invoice_id   uuid,
  actor        text not null default 'system',
  reason       text,
  created_at   timestamptz not null default now()
);
create index if not exists balance_entry_merchant_idx on public.balance_entry (merchant_id, created_at desc);
alter table public.balance_entry enable row level security;

do $$ begin
  create policy balance_partner_read on public.balance_entry
    for select to authenticated using (
      exists (select 1 from public.merchant_user mu where mu.user_id = auth.uid() and mu.merchant_id = balance_entry.merchant_id)
    );
exception when duplicate_object then null; end $$;

-- Sequentially numbered, immutable once issued. Corrections = credit notes.
create sequence if not exists myra_invoice_seq;
create table if not exists public.invoice (
  invoice_id     uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default ('MYRA-' || lpad(nextval('myra_invoice_seq')::text, 5, '0')),
  merchant_id    uuid not null references public.merchant(merchant_id),
  period_start   date not null,
  period_end     date not null,
  line_items     jsonb not null default '[]',
  subtotal_gbp   numeric not null default 0,
  vat_treatment  text,
  vat_gbp        numeric not null default 0,
  total_gbp      numeric not null default 0,
  status         text not null default 'issued' check (status in ('issued', 'paid', 'overdue', 'written_off')),
  issued_at      timestamptz not null default now(),
  due_at         timestamptz,
  paid_at        timestamptz
);
create index if not exists invoice_merchant_idx on public.invoice (merchant_id, issued_at desc);
alter table public.invoice enable row level security;

do $$ begin
  create policy invoice_partner_read on public.invoice
    for select to authenticated using (
      exists (select 1 from public.merchant_user mu where mu.user_id = auth.uid() and mu.merchant_id = invoice.merchant_id)
    );
exception when duplicate_object then null; end $$;

create table if not exists public.credit_note (
  credit_note_id uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoice(invoice_id),
  amount_gbp     numeric not null,
  reason         text not null,
  created_at     timestamptz not null default now()
);
alter table public.credit_note enable row level security;

alter table public.merchant add column if not exists billing_contact_email text;
alter table public.merchant add column if not exists balance_pause_threshold_gbp numeric not null default 0;

-- ── Part 6: application funnel ──────────────────────────────────────────────
create table if not exists public.brand_application (
  application_id uuid primary key default gen_random_uuid(),
  brand_name     text not null,
  store_url      text not null,
  contact_name   text,
  contact_email  text not null,
  category       text,
  price_range    text,
  pitch          text,
  qualification  jsonb,                     -- auto-qualify results
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'auto_rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  merchant_id    uuid references public.merchant(merchant_id),
  created_at     timestamptz not null default now()
);
create index if not exists brand_application_status_idx on public.brand_application (status, created_at desc);
alter table public.brand_application enable row level security;
