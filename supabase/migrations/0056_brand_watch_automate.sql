-- AUTOMATE per brand: once a brand's learning has proven it keeps what Chloe
-- keeps, the Monday scan adds that brand's NEW on-taste pieces to the library
-- itself. auto_keep_since bounds it to pieces discovered after switching on —
-- never the backlog. auto_kept marks the machine's keeps so they are never
-- counted as proof of trust. Idempotent; code keeps working before it runs.
alter table public.watched_brand add column if not exists auto_keep boolean not null default false;
alter table public.watched_brand add column if not exists auto_keep_since timestamptz;
alter table public.brand_watch_queue add column if not exists auto_kept boolean not null default false;
