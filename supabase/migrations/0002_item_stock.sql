-- Add stock availability tracking to item
alter table public.item
  add column if not exists stock_status text
    check (stock_status in ('in_stock', 'low_stock', 'out_of_stock', 'unknown')),
  add column if not exists stock_checked_at timestamptz,
  add column if not exists stock_signal text,
  add column if not exists stock_notes text;

create index if not exists item_stock_status_idx on public.item (stock_status);
