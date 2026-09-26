-- 0070: stylist trials.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- A trial is one piece (and maybe an occasion) that every stylist is asked to
-- style again and again. A batch is one RUN ALL on the bench: every active
-- trial, every stylist, each column kept with its scorecard and, when Chloe
-- judges it, her verdict. Comparing batches is how "did the twenty new
-- pictures help Rosie?" gets a number instead of a feeling. Nothing here
-- touches pilot_look or composed_outfit: a trial has no client and must not
-- appear in either's metrics.

create table if not exists public.stylist_trial (
  trial_id    uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.item(item_id) on delete cascade,
  occasion_id text,                                   -- client-occasions id; null = no occasion
  label       text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  active      boolean not null default true
);
create unique index if not exists stylist_trial_piece_occasion
  on public.stylist_trial (item_id, coalesce(occasion_id, ''));
alter table public.stylist_trial enable row level security;

create table if not exists public.stylist_trial_run (
  run_id          uuid primary key default gen_random_uuid(),
  trial_id        uuid not null references public.stylist_trial(trial_id) on delete cascade,
  stylist_id      uuid not null references public.stylist(stylist_id) on delete cascade,
  batch_id        uuid not null,                      -- one RUN ALL = one batch
  run_at          timestamptz not null default now(),
  items           jsonb not null default '[]'::jsonb, -- the pieces as shown (BenchPiece[])
  item_ids        uuid[] not null default '{}',
  scores          jsonb not null default '{}'::jsonb, -- BenchScorecard, with its version
  verdict         text check (verdict in ('yes', 'no')),
  verdict_note    text,
  wrong_item_ids  uuid[] not null default '{}',
  check_result    jsonb,                              -- LookCheck, when MYRA's eye ran
  model_decisions numeric not null default 0,         -- stylist_model.decisions at run time
  envelope_images int not null default 0,             -- confirmed inspiration images at run time
  brief_hash      text,                               -- sha1 of the brief at run time: "brief changed" between batches
  error           text
);
create index if not exists stylist_trial_run_stylist_idx on public.stylist_trial_run (stylist_id, run_at desc);
create index if not exists stylist_trial_run_trial_idx   on public.stylist_trial_run (trial_id, stylist_id, run_at desc);
alter table public.stylist_trial_run enable row level security;
