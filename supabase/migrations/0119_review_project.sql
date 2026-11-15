-- 0119 · OUTFIT REVIEW PROJECTS — briefs that compose in the background.
--
-- Outfit Review composed one anchor at a time while Chloe watched the page.
-- A project is a brief ("fur coats", "midi skirts, three ways", "New Year's
-- Eve party outfits", or one piece from a screenshot) that MYRA works through
-- on its own: it picks ~20 anchors for the brief, composes looks for each,
-- and keeps every look here so she can open the project later, pick the
-- ones that are good enough for content, and send those to Higgsfield — all
-- while another project composes. Picked looks become draft outfits in an
-- admin_project of the same name (the existing Outfit Projects area), so
-- Canva and the shoot pipeline see them as they see any other outfit.
--
-- review_project       one brief; status is the queue state. `plan` is the
--                      list of anchors chosen for the brief (ask + item id),
--                      written once planning is done, so a run cut off by
--                      Vercel's 300s continues from anchors_tried next time.
-- review_project_look  one composed look (anchor + additions, the same shape
--                      the Review card shows). decision: pending | picked |
--                      skipped. A pick makes the outfit and queues the shoot;
--                      shoot_status follows it.
--
-- Service-role only, like every admin table: RLS on, no policies.

create table if not exists public.review_project (
  project_id        uuid primary key default gen_random_uuid(),
  title             text not null,
  brief             text,
  -- looks: six looks per anchor · three_ways: three named ways to wear the anchor.
  kind              text not null default 'looks' check (kind in ('looks','three_ways')),
  -- When the project is built around ONE piece (a screenshot, a chosen item).
  anchor_item_id    text,
  anchor            jsonb,
  target_anchors    int not null default 20,
  plan              jsonb,
  anchors_total     int not null default 0,
  anchors_tried     int not null default 0,
  looks_count       int not null default 0,
  status            text not null default 'queued' check (status in ('queued','running','done','failed','paused')),
  attempts          int not null default 0,
  error             text,
  -- How the brief was read: the asks MYRA composed from, in a line each.
  notes             jsonb not null default '[]'::jsonb,
  -- The Outfit Project (admin_project) picked looks are filed under.
  admin_project_id  text,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  heartbeat_at      timestamptz,
  finished_at       timestamptz
);
alter table public.review_project enable row level security;
create index if not exists review_project_pick_idx on public.review_project (status, created_at);

create table if not exists public.review_project_look (
  look_id         uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.review_project(project_id) on delete cascade,
  anchor_index    int not null default 0,
  anchor_item_id  text not null,
  anchor          jsonb not null,
  -- three_ways: "WITH A SHIRT", "OVER A DRESS"…
  way_label       text,
  items           jsonb not null default '[]'::jsonb,
  score           numeric,
  confidence      numeric,
  lane            text,
  reasons         jsonb not null default '[]'::jsonb,
  statement       text,
  echoes          jsonb not null default '[]'::jsonb,
  decision        text not null default 'pending' check (decision in ('pending','picked','skipped')),
  outfit_id       text,
  shoot_status    text check (shoot_status in ('queued','running','done','failed')),
  shoot_url       text,
  shoot_error     text,
  shoot_started_at timestamptz,
  created_at      timestamptz not null default now(),
  picked_at       timestamptz
);
alter table public.review_project_look enable row level security;
create index if not exists review_project_look_project_idx on public.review_project_look (project_id, anchor_index, created_at);
create index if not exists review_project_look_shoot_idx on public.review_project_look (shoot_status, picked_at) where shoot_status in ('queued','running');
