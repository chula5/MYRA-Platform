-- New-user onboarding: brand taste, age range, outfit likes/dislikes.

-- 1. Age ranges on outfits (admin-only; never shown in The Edit / feed).
--    Used to show age-appropriate outfits during onboarding.
alter table public.outfit
  add column if not exists age_ranges text[] not null default '{}';

-- 2. One row per user capturing their onboarding answers.
create table if not exists public.signup_preference (
  user_id             uuid        primary key,
  email               text,
  age_range           text,
  brand_groups        text[]      not null default '{}',
  liked_outfit_ids    uuid[]      not null default '{}',
  disliked_outfit_ids uuid[]      not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists signup_preference_created_at_idx
  on public.signup_preference (created_at desc);

-- Locked down; the service-role client (server actions) bypasses RLS.
alter table public.signup_preference enable row level security;
