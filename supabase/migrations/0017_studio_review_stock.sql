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
-- status columns may be Postgres ENUM types (outfit_status_enum et al.) or
-- plain text with a CHECK constraint depending on how the base schema was
-- created — the DO blocks below detect which and extend accordingly.

-- ── Outfit: allow the new statuses ───────────────────────────────────────────
do $$
declare
  t text;
  v text;
begin
  select udt_name into t
  from information_schema.columns
  where table_schema = 'public' and table_name = 'outfit' and column_name = 'status';

  if t is not null and exists (select 1 from pg_type where typname = t and typtype = 'e') then
    -- Enum column → extend the enum type.
    foreach v in array array['approved_rendering', 'render_failed', 'needs_desktop', 'paused'] loop
      execute format('alter type public.%I add value if not exists %L', t, v);
    end loop;
  else
    -- Text column → widen the check constraint.
    execute 'alter table public.outfit drop constraint if exists outfit_status_check';
    execute $c$alter table public.outfit add constraint outfit_status_check check (status in (
      'draft', 'in_review', 'live', 'archived',
      'approved_rendering', 'render_failed', 'needs_desktop', 'paused'
    ))$c$;
  end if;
end $$;

-- ── Item: allow out_of_stock ─────────────────────────────────────────────────
do $$
declare
  t text;
begin
  select udt_name into t
  from information_schema.columns
  where table_schema = 'public' and table_name = 'item' and column_name = 'status';

  if t is not null and exists (select 1 from pg_type where typname = t and typtype = 'e') then
    execute format('alter type public.%I add value if not exists %L', t, 'out_of_stock');
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
