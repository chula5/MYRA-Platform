-- 0076: which queued pieces the shop has just put out.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Chloe's rule as autumn starts: don't queue summer clothes, because they get
-- destocked before anyone buys them — unless they are in the shop's new-in
-- section, and new-in pieces should lead the queue.
--
-- The scan works out new-in from the shop's own collections (src/lib/brand-watch-newin.ts)
-- and the queue has to remember the answer, because the queue is what the admin
-- page reads. Without the column, every piece would look equally new.
--
-- null/false both mean "not known to be new in". A shop that cannot be asked
-- (not Shopify — none of the fourteen browser-scanned brands serve
-- /collections.json) yields false throughout, which is the safe reading: no
-- piece is exempted from the no-summer rule by a guess.
alter table public.brand_watch_queue add column if not exists new_in boolean not null default false;
create index if not exists idx_brand_watch_queue_new_in on public.brand_watch_queue (watched_brand_id, status, new_in);
