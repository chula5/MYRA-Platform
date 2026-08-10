-- 0024_brand_logos.sql
-- Brand logos live in the backend: one canonical logo_url per brand (persisted
-- to Cloudinary), so every brand tile on the site shows a real logo instead of
-- a text fallback. Populated by the logo backfill; editable per brand.
alter table brand add column if not exists logo_url text;
