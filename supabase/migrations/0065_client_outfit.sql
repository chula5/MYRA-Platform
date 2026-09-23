-- 0065_client_outfit.sql
-- THE OUTFITS SHE PUTS TOGETHER HERSELF.
--
-- Everything she has seen until now was assembled for her: MYRA composes, the
-- stylist checks, she says yes or no. This is the other direction. She takes
-- pieces she already owns and pieces she has saved from her looks, puts them
-- side by side, and sees whether they hold together.
--
-- WHY A NEW TABLE RATHER THAN pilot_look.
-- A pilot_look belongs to a delivery and carries publish semantics: it is
-- composed, reviewed, then sent, and visible_to_client decides whether she may
-- see it at all. Hers is the opposite on every count — it exists the moment she
-- makes it, nobody reviews it, and it is hers to see by definition. Putting her
-- builds in the same table would mean a row that is permanently pre-approved,
-- attached to a delivery that never happened, and the review queue would have to
-- learn to ignore it everywhere. Its own table says what it is.
--
-- WHY THE PIECES ARE STORED IN FULL.
-- pieces holds the name, brand, image and colour of each garment, not just an
-- item id. A retail piece can be delisted and an owned piece can be deleted from
-- her wardrobe, and when that happens the outfit she made should still be the
-- outfit she made. The id is kept alongside so a live piece can still be looked
-- up; the copy is what makes the record survive.
--
-- Service-role only, like every other pilot table: RLS on, no policies. Her app
-- reaches this through server actions that resolve the member from her session.

create table if not exists public.client_outfit (
  outfit_id  uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.pilot_member(member_id) on delete cascade,

  -- What she called it. Null is fine: not every outfit needs a name.
  name       text,
  -- What she was dressing for, when she said. Same vocabulary as pilot_delivery.
  occasion   text check (occasion is null or occasion in
               ('work_standard','work_elevated','casual_day','dinner_drinks','event','travel')),

  -- [{ item_id, source: 'wardrobe' | 'saved', product_name, brand_name,
  --    item_type, slot, colour_family, image_url }]
  pieces     jsonb not null default '[]'::jsonb,

  -- What MYRA said about it when she saved it: { tone, line, suggestions }.
  -- Kept as written rather than recomputed on read, so the admin sees the note
  -- she was actually given, not what today's rules would say about it.
  verdict    jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_outfit_member
  on public.client_outfit (member_id, created_at desc);

alter table public.client_outfit enable row level security;
