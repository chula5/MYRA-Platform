-- 0066: auto-keep by measured confidence, per brand.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- AUTOMATE already keeps pieces whose learned lift clears a fixed rule. This
-- adds the thing you can actually set a bar against: the CHANCE Chloe would
-- keep a piece, fitted per brand on that brand's own decisions, and measured
-- walk-forward before it is allowed to act (lib/brand-watch-confidence).
--
-- auto_keep_confidence  — the switch. Off until she turns it on.
-- confidence_bar        — the bar, 0.5..0.99 (default 0.92).
-- auto_keep_confidence_since — only pieces found after the switch went on.
alter table public.watched_brand add column if not exists auto_keep_confidence boolean not null default false;
alter table public.watched_brand add column if not exists confidence_bar numeric not null default 0.92;
alter table public.watched_brand add column if not exists auto_keep_confidence_since timestamptz;
