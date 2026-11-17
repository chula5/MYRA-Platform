-- One mirror row per page.
--
-- Two asks for the same piece racing on different servers each found no row
-- and each wrote one (up to four copies of a page, 2026-10-12 → 11-09), so
-- Browse answered the same cami three times and every copy was styled and
-- read again. ensureMirrorItem now resolves to the oldest row and reselects
-- after an insert; this index makes the second write impossible rather than
-- merely unlikely. Same expression as scripts/merge-mirror-duplicates.mjs,
-- which must run first: the index cannot be built while copies remain.
--
-- item_merge records every fold (which row went into which), written by the
-- script; created here so the table exists even where the script never ran.

create table if not exists public.item_merge (
  dup_item_id  uuid primary key,
  kept_item_id uuid not null,
  base_url     text not null,
  merged_at    timestamptz not null default now(),
  note         text
);
alter table public.item_merge enable row level security;

create unique index if not exists item_mirror_page_uidx
  on public.item (regexp_replace(retailer_url, '[?#].*$', ''))
  where discovery_source = 'mirror' and status <> 'archived' and retailer_url is not null;
