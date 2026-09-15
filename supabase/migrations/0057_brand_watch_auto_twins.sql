-- AUTO-KEEP TWINS per brand: the first, narrower step before AUTOMATE. A new
-- piece from the same design line as one Chloe kept herself (and not a twin of
-- anything she skipped) goes straight to the library. Measured before building:
-- 163 of 173 such pieces were kept (94%). auto_keep_twins_since bounds the
-- scheduled keeps to pieces discovered after switching on. Idempotent.
alter table public.watched_brand add column if not exists auto_keep_twins boolean not null default false;
alter table public.watched_brand add column if not exists auto_keep_twins_since timestamptz;
