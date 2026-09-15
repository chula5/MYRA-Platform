-- Why a Brand Watch piece was skipped, so the learning can weigh the reason:
-- not_style · colour · type · too_young · price. Nullable; old skips have none.
alter table public.brand_watch_queue add column if not exists skip_reason text;
