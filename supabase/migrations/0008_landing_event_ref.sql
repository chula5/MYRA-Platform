-- Referral attribution for landing-page events.
-- e.g. myraassistant.co.uk/?ref=tdfb  → ref = 'tdfb'
alter table public.landing_event
  add column if not exists ref text;

create index if not exists landing_event_ref_idx on public.landing_event (ref);
