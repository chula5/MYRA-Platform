-- Capture the in-stock size labels from the last stock check (e.g. {S,M,L} or
-- {37,39}). Populated by the stock sweep for Shopify-style product pages; empty
-- where sizes can't be parsed (the coarse stock_status still applies).
alter table public.item
  add column if not exists stock_sizes text[];
