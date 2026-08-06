-- 0017_studio_review_stock.sql
-- MYRA Studio: mobile swipe review queue + stock sentinel.
--
--  · New outfit statuses: approved_rendering (approved, Higgsfield render in
--    flight), render_failed (two render attempts failed), needs_desktop
--    (mobile "none of these" — needs the desktop studio), paused (a live
--    outfit pulled from the feed because an item went out of stock).
--  · New item status: out_of_stock (distinct from archived — still tracked
--    for restock for 30 days).
--  · render_job: the single sequential Higgsfield render queue. Approvals
--    are prioritised ahead of stock swaps; one render runs at a time.
--  · audit_log: every automated action (auto-swap, pause, archive, render).
--  · stock_swap: swap history for undo / restock-restore links in emails.
--  · email_log: sent-digest ledger (caps review digests at 2/day).
--
-- ── Outfit: allow the new statuses ───────────────────────────────────────────
-- outfit.status is the enum type outfit_status_enum in the live database (the
-- exact name Postgres reports in its error messages), so extend it directly —
-- no detection, no CHECK constraints on an enum column.
alter type outfit_status_enum add value if not exists 'approved_rendering';
alter type outfit_status_enum add value if not exists 'render_failed';
alter type outfit_status_enum add value if not exists 'needs_desktop';
alter type outfit_status_enum add value if not exists 'paused';

-- ── Item: allow out_of_stock ─────────────────────────────────────────────────
-- item.status's type name isn't known for certain, so resolve the column's
-- REAL type from the catalogs (unwrapping any domain) and extend it; fall back
-- to a CHECK constraint only if the column is genuinely plain text.
do $$
declare
  tid oid;
begin
  select a.atttypid into tid
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'item' and a.attname = 'status'
    and a.attnum > 0 and not a.attisdropped;

  -- Unwrap domains to their base type.
  while exists (select 1 from pg_type where oid = tid and typtype = 'd') loop
    select typbasetype into tid from pg_type where oid = tid;
  end loop;

  if exists (select 1 from pg_type where oid = tid and typtype = 'e') then
    execute format('alter type %s add value if not exists %L', tid::regtype, 'out_of_stock');
  else
    execute 'alter table public.item drop constraint if exists item_status_check';
    execute $c$alter table public.item add constraint item_status_check check (status in (
      'draft', 'ready', 'live', 'archived', 'out_of_stock'
    ))$c$;
  end if;
end $$;

-- ── Outfit: review/render bookkeeping columns ────────────────────────────────
alter table public.outfit
  add column if not exists composed_group_url text,          -- cached composed item-group image (review cards)
  add column if not exists review_confidence numeric,        -- cached composer coherence score at queue time
  add column if not exists paused_reason text,               -- e.g. 'item_out_of_stock:<item_id>'
  add column if not exists last_render_error text;

-- ── Item: strike tracking ────────────────────────────────────────────────────
alter table public.item
  add column if not exists oos_strikes int not null default 0,  -- consecutive OOS-indicating checks
  add column if not exists oos_since timestamptz,               -- when status flipped to out_of_stock
  add column if not exists status_before_oos text;              -- to restore on restock

-- ── Render queue — ONE sequential queue for approvals + stock swaps ──────────
create table if not exists render_job (
  job_id      uuid primary key default gen_random_uuid(),
  outfit_id   uuid not null,
  trigger     text not null check (trigger in ('approval', 'stock_swap', 'restock_restore', 'manual')),
  priority    int  not null default 2,   -- 1 = approval (first), 2 = stock swap/restore
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts    int  not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists render_job_pick_idx on render_job (status, priority, created_at);
alter table render_job enable row level security;

-- ── Audit log — every automated action, before/after ─────────────────────────
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  action      text not null,        -- 'approve','reject','swap','auto_swap','pause','republish','archive','render_queued','render_done','render_failed','undo_swap','restock_restore','oos_detected','back_in_stock'
  entity      text not null,        -- 'outfit' | 'item' | 'render_job'
  entity_id   uuid,
  trigger     text,                 -- 'mobile_review' | 'stock_sentinel' | 'email_link' | 'cron' | 'desktop'
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_entity_idx on audit_log (entity, entity_id);
alter table audit_log enable row level security;

-- ── Stock swaps — undo / restore tokens for email links ──────────────────────
create table if not exists stock_swap (
  swap_id     uuid primary key default gen_random_uuid(),
  outfit_id   uuid not null,
  slot        text not null,
  out_item_id uuid not null,        -- the item that left (dead or reverted)
  in_item_id  uuid not null,        -- the replacement
  similarity  numeric,              -- item-vector cosine at swap time
  mode        text not null check (mode in ('auto', 'manual', 'restock_restore')),
  undo_token  uuid not null default gen_random_uuid(),
  undone      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists stock_swap_outfit_idx on stock_swap (outfit_id, created_at desc);
create unique index if not exists stock_swap_token_idx on stock_swap (undo_token);
alter table stock_swap enable row level security;

-- ── Email ledger — audit + "never more than 2 review digests a day" ──────────
create table if not exists email_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,        -- 'review_digest' | 'stock_report'
  subject     text,
  meta        jsonb,
  sent_at     timestamptz not null default now()
);
create index if not exists email_log_kind_idx on email_log (kind, sent_at desc);
alter table email_log enable row level security;
