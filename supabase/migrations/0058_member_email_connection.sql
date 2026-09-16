-- EMAIL PURCHASE CONNECTOR — a client's inbox (Gmail sign-in, or Virgin Media /
-- Blueyonder over IMAP with a Virgin Media Mail app password) is scanned for
-- clothes she has bought in the past year. Found pieces wait for review before
-- they become owned items in her wardrobe. Email bodies are never stored — only
-- the extracted pieces and the message id. Secrets are AES-256-GCM encrypted by
-- the app (EMAIL_SECRET_ENCRYPTION_KEY). Service-role only. Idempotent.

create table if not exists public.member_email_connection (
  connection_id   uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.pilot_member(member_id) on delete cascade,
  provider        text not null check (provider in ('gmail', 'imap')),
  email           text not null,
  imap_host       text,
  secret_enc      text not null,
  scan_from       timestamptz not null default (now() - interval '12 months'),
  last_scanned_at timestamptz,
  status          text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  error           text,
  created_at      timestamptz not null default now(),
  unique (member_id, provider, email)
);
alter table public.member_email_connection enable row level security;

create table if not exists public.email_scan_job (
  job_id        uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.member_email_connection(connection_id) on delete cascade,
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- phase 'list' finds candidate messages; 'read' extracts them in chunks.
  phase         text not null default 'list' check (phase in ('list', 'read')),
  message_ids   text[] not null default '{}',
  cursor        int not null default 0,
  found         int not null default 0,
  ai_calls      int not null default 0,
  attempts      int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
alter table public.email_scan_job enable row level security;
create index if not exists idx_email_scan_job_pick on public.email_scan_job (status, created_at);

create table if not exists public.email_purchase_find (
  find_id       uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  connection_id uuid references public.member_email_connection(connection_id) on delete set null,
  message_id    text not null,
  find_key      text not null,
  retailer      text,
  order_id      text,
  order_date    date,
  product_name  text not null,
  brand_name    text,
  colour        text,
  size          text,
  price         numeric,
  currency      text,
  image_url     text,
  product_url   text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  item_id       uuid references public.item(item_id) on delete set null,
  error         text,
  created_at    timestamptz not null default now(),
  -- The same piece in an order confirmation and its dispatch email is one find.
  unique (member_id, find_key)
);
alter table public.email_purchase_find enable row level security;
create index if not exists idx_email_find_member on public.email_purchase_find (member_id, status, order_date desc);
