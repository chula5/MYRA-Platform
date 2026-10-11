-- Index every foreign-key column that points at item(item_id).
--
-- Without these, deleting an item makes Postgres scan each referencing table
-- in full (once per deleted row) to cascade / null / check the reference.
-- brand_watch_queue alone is ~19 MB, so deleting 15 items from the Item
-- Library took >5s and tipped over the 8s statement timeout (57014).
-- Idempotent.

create index if not exists brand_watch_queue_item_id_idx             on public.brand_watch_queue (item_id);
create index if not exists mirror_page_product_item_id_idx           on public.mirror_page_product (item_id);
create index if not exists outfit_quality_candidate_item_item_id_idx on public.outfit_quality_candidate_item (item_id);
create index if not exists taste_log_item_id_idx                     on public.taste_log (item_id);
create index if not exists email_purchase_find_item_id_idx           on public.email_purchase_find (item_id);
create index if not exists taste_event_item_id_idx                   on public.taste_event (item_id);
create index if not exists recently_viewed_item_id_idx               on public.recently_viewed (item_id);
create index if not exists member_saved_item_item_id_idx             on public.member_saved_item (item_id);
create index if not exists stock_alert_item_id_idx                   on public.stock_alert (item_id);
