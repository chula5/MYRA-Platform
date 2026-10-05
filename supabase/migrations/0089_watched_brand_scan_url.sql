-- 0089: SCAN IN CHROME for mirror-fed brands.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- A brand no server can read (J.Crew, Reformation, Free People — bot walls on
-- every route) is fed by the Mirror as someone browses it. This gives Brand
-- Watch a button for that: the brand's new-in page, which SCAN IN CHROME
-- opens in Chloe's Chrome with a marker only the extension sees; the
-- extension then scrolls and pages through it, and every grid it reads is
-- queued here as it would be from a Shopify feed.

alter table public.watched_brand add column if not exists scan_url text;

-- The three she asked for. Only where nothing has been set by hand.
update public.watched_brand set scan_url = 'https://www.jcrew.com/plp/womens/categories/clothing/new-arrivals'
  where base_url in ('https://jcrew.com', 'https://www.jcrew.com') and scan_url is null;
update public.watched_brand set scan_url = 'https://www.thereformation.com/collections/new-arrivals'
  where base_url in ('https://thereformation.com', 'https://www.thereformation.com') and scan_url is null;
update public.watched_brand set scan_url = 'https://www.freepeople.com/whats-new/'
  where base_url in ('https://freepeople.com', 'https://www.freepeople.com') and scan_url is null;
