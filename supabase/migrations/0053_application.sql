-- APPLICATIONS — the private-stylist waitlist.
--
-- Someone applies from the landing (the APPLY NOW pop-out) and answers a few
-- taste questions. Chloe reviews these and accepts people one at a time, then
-- builds each accepted member their own refined edit. Anonymous (no account
-- yet), so it is keyed by its own id, not a user.
--
-- RLS on with NO policies: the anon/browser client can't touch it. The submit
-- server action writes with the service-role admin client.

create table if not exists public.application (
  id                 uuid        primary key default gen_random_uuid(),
  name               text,
  email              text        not null,
  brands             text,       -- brands they love, free text
  price_range        text,       -- roughly what they spend
  style_inspiration  text,       -- people whose style inspires them
  note               text,       -- anything else they add
  status             text        not null default 'new',  -- new | accepted | declined
  created_at         timestamptz not null default now()
);

create index if not exists application_created_at_idx on public.application (created_at desc);
create index if not exists application_status_idx on public.application (status);

alter table public.application enable row level security;
