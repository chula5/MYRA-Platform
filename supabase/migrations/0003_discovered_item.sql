-- discovered_item: AI-surfaced pieces similar to a source item.
-- Stored separately so they can be triaged (saved / dismissed) before becoming real items.

create table if not exists public.discovered_item (
  discovered_id uuid primary key default gen_random_uuid(),
  source_item_id uuid references public.item(item_id) on delete cascade,

  title text not null,
  brand_name text,
  retailer_url text,
  image_url text,
  price text,
  currency text,

  why_interesting text,
  status text not null default 'new' check (status in ('new', 'saved', 'dismissed')),

  created_at timestamptz not null default now()
);

create index if not exists discovered_item_status_idx on public.discovered_item (status);
create index if not exists discovered_item_source_idx on public.discovered_item (source_item_id);
create index if not exists discovered_item_created_at_idx on public.discovered_item (created_at desc);
