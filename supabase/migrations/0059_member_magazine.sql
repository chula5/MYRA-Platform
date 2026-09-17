-- MYRA MAGAZINE — the newsletters she already subscribes to, read for her.
--
-- One row per newsletter email MYRA has read, holding only the pieces worth
-- her eye (picks) and the shop links. The email itself is never stored. A
-- publication she mutes is skipped on the next read.

create table if not exists public.member_magazine_issue (
  issue_id      uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.pilot_member(member_id) on delete cascade,
  connection_id uuid references public.member_email_connection(connection_id) on delete set null,
  message_id    text not null,
  publication   text not null,
  subject       text,
  received_at   timestamptz,
  hero_image    text,
  -- [{ name, brand, price, currency, image_url, url, why }]
  picks         jsonb not null default '[]'::jsonb,
  status        text not null default 'live' check (status in ('live', 'hidden')),
  created_at    timestamptz not null default now(),
  -- One issue per email.
  unique (member_id, message_id)
);
alter table public.member_magazine_issue enable row level security;
create index if not exists idx_magazine_issue_member on public.member_magazine_issue (member_id, status, received_at desc);

create table if not exists public.member_magazine_publisher (
  member_id   uuid not null references public.pilot_member(member_id) on delete cascade,
  publication text not null,
  muted       boolean not null default false,
  seen_at     timestamptz not null default now(),
  primary key (member_id, publication)
);
alter table public.member_magazine_publisher enable row level security;
