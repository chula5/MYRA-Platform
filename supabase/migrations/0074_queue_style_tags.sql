-- 0074: style tags on a queued piece, so confidence can score the GARMENT.
-- Run manually in the Supabase SQL editor (idempotent).
--
-- Why: the confidence number on a queue card could only ever read brand
-- history, colour family, price band and the words of the product name. It
-- could not see the clothes. Measured walk-forward on 5,553 real decisions
-- (2026-09-29) that scored AUC 0.560 — a coin flip is 0.500 — and auto-accept
-- at the top decile would have been right 44.8% of the time against a 64.7%
-- base rate.
--
-- The library already carries these seventeen 1-5 dimensions on 97% of its
-- items, and every accepted piece becomes one. What was missing is the other
-- half of the evidence: the pieces she SKIPPED never became items, so nothing
-- recorded what she turns down. These columns put both sides in one place.
--
-- Same names and same 1-5 meanings as public.item, so a kept piece carries its
-- tags straight into the library instead of arriving untagged.
alter table public.brand_watch_queue add column if not exists fit smallint;
alter table public.brand_watch_queue add column if not exists length smallint;
alter table public.brand_watch_queue add column if not exists rise smallint;
alter table public.brand_watch_queue add column if not exists structure smallint;
alter table public.brand_watch_queue add column if not exists shoulder smallint;
alter table public.brand_watch_queue add column if not exists neckline smallint;
alter table public.brand_watch_queue add column if not exists sleeve smallint;
alter table public.brand_watch_queue add column if not exists waist_definition smallint;
alter table public.brand_watch_queue add column if not exists leg_opening smallint;
alter table public.brand_watch_queue add column if not exists surface smallint;
alter table public.brand_watch_queue add column if not exists colour_depth smallint;
alter table public.brand_watch_queue add column if not exists pattern smallint;
alter table public.brand_watch_queue add column if not exists sheen smallint;
alter table public.brand_watch_queue add column if not exists material_weight smallint;
alter table public.brand_watch_queue add column if not exists material_formality smallint;
alter table public.brand_watch_queue add column if not exists jewellery_scale smallint;
alter table public.brand_watch_queue add column if not exists jewellery_formality smallint;
alter table public.brand_watch_queue add column if not exists colour_hex text;

-- The shop's own copy. fetchCatalogue already reads body_html for keyword
-- scoring and then throws it away; keeping it lets the cheap text tier read
-- fit, sleeve, neckline and material straight from the description, so most
-- pieces never need an image read at all.
alter table public.brand_watch_queue add column if not exists description text;

-- Which tier answered, and when. 'rules' is free, 'text' is a batched
-- description read, 'vision' is the image. Recorded so the evaluator can ask
-- whether the expensive tier is actually buying any accuracy.
alter table public.brand_watch_queue add column if not exists tag_source text;
alter table public.brand_watch_queue add column if not exists tagged_at timestamptz;

-- The look of the garment, in the model's own words, and that phrase turned
-- into a vector.
--
-- The seventeen 1-5 dimensions above describe how a garment is MADE — rise,
-- shoulder, leg opening. Measured on 1,495 decisions they scored AUC 0.655,
-- and the reason is that "style" is not a construction. Asked instead to
-- describe how the piece LOOKS, and compared as an embedding, the same pieces
-- scored 0.756 — beating the existing confidence model's 0.708 on the same
-- held-out set, and holding at 0.698-0.756 across every split tested.
--
-- Within a single brand, where brand habit cannot help at all, style scores
-- 0.721 and the dimensions 0.751 against the existing model's 0.605. That is
-- the new-brand case, and it is the whole reason this is being built.
--
-- jsonb rather than pgvector on purpose: it needs no extension, and scoring
-- loads one brand's exemplars at a time rather than the whole catalogue.
alter table public.brand_watch_queue add column if not exists style_phrase text;
alter table public.brand_watch_queue add column if not exists style_embedding jsonb;

-- Finding what still needs tagging, per brand, without a sequential scan.
create index if not exists idx_brand_watch_queue_untagged
  on public.brand_watch_queue (brand_id, status)
  where tagged_at is null;

-- Read once, keyed by the image, and never paid for twice — the same contract
-- as brand_watch_colour_read, which has already saved 3,232 repeat reads. The
-- whole tag set lives in one jsonb blob so adding a dimension later does not
-- invalidate everything already bought.
create table if not exists public.brand_watch_tag_read (
  image_url text primary key,
  tags jsonb not null,
  model text,
  -- The style phrase and its vector, so a rerun never has to describe or embed
  -- the same image twice.
  phrase text,
  embedding jsonb,
  created_at timestamptz not null default now()
);
alter table public.brand_watch_tag_read add column if not exists phrase text;
alter table public.brand_watch_tag_read add column if not exists embedding jsonb;
