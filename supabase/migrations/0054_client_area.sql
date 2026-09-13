-- 0054: The client area — what she can see, what she asked, what she is told.
-- Run AFTER 0053, manually in the Supabase SQL editor (idempotent).
--
-- Alison has 61 shot looks and has never seen one of them: every verdict so
-- far is Chloe relaying a reaction by hand. This is what she logs into.
--
-- The important column is pilot_look.visible_to_client. Composing for a client
-- live means she could see a look nobody reviewed, and at a 55% clean rate
-- roughly one in two would normally have been edited. So nothing reaches her
-- unless it is either approved by hand or scored high enough to stand on its
-- own; everything else stays invisible and waits in the review queue.

alter table public.pilot_look add column if not exists visible_to_client boolean not null default false;
alter table public.pilot_look add column if not exists published_at timestamptz;
-- 0..1, from the composer's own signals. Null on anything composed before this.
alter table public.pilot_look add column if not exists confidence numeric;
-- The question that produced it, when a look came from her chat.
alter table public.pilot_look add column if not exists from_question text;

create index if not exists idx_pilot_look_visible
  on public.pilot_look (delivery_id) where visible_to_client;

-- ── What she is told ────────────────────────────────────────────────────────
create table if not exists public.pilot_notification (
  notification_id uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.pilot_member(member_id) on delete cascade,
  kind            text not null default 'looks_ready' check (kind in ('looks_ready', 'note')),
  body            text not null,
  look_ids        jsonb not null default '[]'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_pilot_notification_member
  on public.pilot_notification (member_id, created_at desc);
alter table public.pilot_notification enable row level security;

-- ── What she asked ──────────────────────────────────────────────────────────
-- Kept in full so Chloe can read the thread: the questions a client actually
-- asks are the clearest statement of what she wants that the pilot will ever
-- get, and they are worth more than the answers.
create table if not exists public.pilot_chat_message (
  message_id  uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  role        text not null check (role in ('client', 'myra')),
  body        text not null,
  look_ids    jsonb not null default '[]'::jsonb,
  item_ids    jsonb not null default '[]'::jsonb,
  -- what the intent pass read out of her question, for tuning it later
  intent      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pilot_chat_member
  on public.pilot_chat_message (member_id, created_at);
alter table public.pilot_chat_message enable row level security;

-- Service-role only on both, same as every other pilot table: the client area
-- reads through server actions that check the signed-in user, never directly.
