-- 0017_search_result_count.sql
-- Store how many outfits a search returned, so admin can see which searches got
-- no results (content gaps to fill).

alter table landing_event add column if not exists result_count int;
