-- landing_event: lightweight analytics for the public landing page.
-- Inserted via the service-role client (server action) — no anon write access.

create table if not exists public.landing_event (
  event_id   uuid        primary key default gen_random_uuid(),
  event_type text        not null,   -- 'pageview' | 'cta_click' | 'instagram_click' | 'tiktok_click'
  path       text        not null default '/',
  occurred_at timestamptz not null default now()
);

create index if not exists landing_event_occurred_at_idx on public.landing_event (occurred_at desc);
create index if not exists landing_event_type_path_idx   on public.landing_event (event_type, path);

-- Lock down via RLS; service role bypasses this automatically.
alter table public.landing_event enable row level security;
