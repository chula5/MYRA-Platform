-- 0034: Brand Watch browser route — scan non-Shopify stores via their
-- sitemap + JSON-LD product data. Run AFTER 0033 in the Supabase SQL editor.
--
-- platform: how this brand is scanned. 'shopify' = /products.json feed;
-- 'browser' = sitemap discovery + per-page JSON-LD (set automatically when a
-- brand turns out not to be on Shopify).
-- scan_state: live progress of a running browser scan ({running, done, total,
-- remaining, started_at}) — written server-side as the scan walks pages, so
-- closing the page never cancels a scan and progress survives navigation.

alter table public.watched_brand add column if not exists platform text not null default 'shopify';
do $$ begin
  alter table public.watched_brand add constraint watched_brand_platform_check check (platform in ('shopify', 'browser'));
exception when duplicate_object then null; end $$;
alter table public.watched_brand add column if not exists scan_state jsonb;
