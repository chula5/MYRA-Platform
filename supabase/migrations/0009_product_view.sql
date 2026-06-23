-- product_view_clip: short demo videos of MYRA areas, shown in the admin
-- "Product View" showcase. Managed via the service-role client (server actions).

create table if not exists public.product_view_clip (
  clip_id    uuid        primary key default gen_random_uuid(),
  title      text        not null,
  caption    text,
  video_url  text        not null,
  poster_url text,
  sort_order int         not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_view_clip_sort_idx
  on public.product_view_clip (sort_order asc, created_at asc);

alter table public.product_view_clip enable row level security;
