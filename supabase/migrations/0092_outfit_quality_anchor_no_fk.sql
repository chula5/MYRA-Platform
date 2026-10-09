-- 0092 · The anchor on a frozen candidate version is provenance, not a live
-- reference. 0091 gave it a foreign key to item, which (a) would stop a retired
-- item ever being deleted while a Quality Lab version remembers it, and
-- (b) made a bad item id fail at the version insert instead of the item
-- manifest insert, changing the documented write order. Keep the column and
-- its index; drop the constraint.
alter table public.outfit_quality_candidate_version
  drop constraint if exists outfit_quality_candidate_version_anchor_item_id_fkey;
