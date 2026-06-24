-- saved_outfit: outfits a user has saved/liked. Powers the user's saved list,
-- personalised recommendations, and admin taste analytics.

create table if not exists public.saved_outfit (
  user_id    uuid        not null,
  outfit_id  uuid        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_id)
);

create index if not exists saved_outfit_user_idx   on public.saved_outfit (user_id);
create index if not exists saved_outfit_outfit_idx on public.saved_outfit (outfit_id);

alter table public.saved_outfit enable row level security;
