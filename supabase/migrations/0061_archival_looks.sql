-- 0061_archival_looks.sql
-- ARCHIVAL LOOKS — photos of what a member already wears (her Instagram, or
-- photos she uploads), kept in her Dressing Room so MYRA can see how she puts
-- things together. Each photo also runs through the wardrobe import pipeline
-- (0046): the garments MYRA spots are offered to her one by one, and only the
-- ones she taps enter her wardrobe. Run AFTER 0046.
--
-- Service-role only — every access goes through server actions that resolve
-- the member from her session (or from HER VIEW, admin only).

create table if not exists public.member_instagram_connection (
  connection_id    uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.pilot_member(member_id) on delete cascade,
  ig_user_id       text not null,
  username         text,
  token_enc        text not null,          -- long-lived token, AES-GCM (email/secrets.ts)
  token_expires_at timestamptz,
  last_synced_at   timestamptz,
  status           text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  error            text,
  created_at       timestamptz not null default now(),
  unique (member_id, ig_user_id)
);
alter table public.member_instagram_connection enable row level security;

create table if not exists public.archival_look (
  look_id      uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.pilot_member(member_id) on delete cascade,
  source       text not null check (source in ('instagram', 'upload')),
  source_id    text not null,              -- Instagram media id, or a hash of the upload
  permalink    text,
  caption      text,
  taken_at     timestamptz,
  photo_id     uuid references public.wardrobe_photo(photo_id) on delete set null,
  -- MYRA's read of the whole outfit: how she wears things, not just what.
  analysis     jsonb,
  taste_vector jsonb,                      -- 34-dim, same space as outfit.taste_vector
  read_at      timestamptz,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (member_id, source, source_id)
);
alter table public.archival_look enable row level security;
create index if not exists idx_archival_look_member on public.archival_look (member_id, taken_at desc nulls last);
