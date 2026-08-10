-- 0025_click_attribution.sql
-- Ties retailer click-throughs to the account that made them.
--
-- item_click is the COMPLETE outbound log — every click to a retailer is
-- written here, affiliate or not (the `click` table from 0019 only covers links
-- routed for commission). Until now it recorded only what was clicked, never by
-- whom, so "what did this person click through to?" was unanswerable.
--
-- user_id is NULLABLE and stays null for logged-out visitors — most traffic is
-- anonymous and that is fine. Historical rows cannot be attributed after the
-- fact; they keep a null user_id honestly rather than being guessed at.

alter table public.item_click add column if not exists user_id uuid;

create index if not exists item_click_user_idx on public.item_click (user_id, clicked_at desc);
create index if not exists item_click_clicked_at_idx on public.item_click (clicked_at desc);
