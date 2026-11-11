-- MEMBER AVATAR, phase 2 — her wardrobe on her avatar.
--
--   · avatar_way.item_types now use the item table's real item_type vocabulary (detect.ts
--     ITEM_TYPES): 't-shirt' not 't_shirt', 'sneaker' not 'trainer', dresses by length, no
--     invented types. A way that names no real type never fires.
--   · outer.cinched: every jacket is also shot pulled in at the waist, so that when a scarf
--     or belt goes round her waist the jacket closes under it (Chloe, 2026-11-08).
--   · scarf.belt is shot on the plain base (no jacket in the picture), so one scarf layer
--     serves every jacket; it swaps the jacket to its cinched state instead.
--   · belt.waist: her belts, over tops and bottoms; cinches a jacket the same way.
--   · avatar_look gets a name and the finish cost; member_avatar remembers when her
--     wardrobe was last queued so new pieces can be picked up cheaply.

alter table public.avatar_look add column if not exists name text;
alter table public.avatar_look add column if not exists cost_gbp numeric(8,4) not null default 0;
alter table public.member_avatar add column if not exists wardrobe_queued_at timestamptz;

-- real types only
update public.avatar_way set item_types = array['shirt','blouse','t-shirt','knitwear','corset','bodysuit'] where way_key in ('top.untucked','top.tucked');
update public.avatar_way set item_types = array['trousers','jeans','shorts','skirt'] where way_key = 'bottom.worn';
update public.avatar_way set item_types = array['mini_dress','midi_dress','maxi_dress','shirt_dress','slip_dress'] where way_key = 'dress.worn';
update public.avatar_way set item_types = array['coat','trench','jacket','blazer','gilet','cape'] where way_key = 'outer.worn';
update public.avatar_way set item_types = array['scarf'] where way_key like 'scarf.%';
update public.avatar_way set item_types = array['boot','heel','flat','sneaker','mule','sandal'] where way_key = 'shoes.worn';

-- the plain ways follow the product photo: done up in the photo → done up on her (Chloe, 2026-11-09)
update public.avatar_way set shoot_prompt = 'she is wearing the {piece} from image 2, fastened exactly as it is in image 2 (if it is shown buttoned or zipped up, it stays done up; if shown open, it stays open), hanging loose and untucked so its hem falls over the top of the grey shorts' where way_key = 'top.untucked';
update public.avatar_way set shoot_prompt = 'she is wearing the {piece} from image 2, fastened exactly as it is in image 2 (if it is shown buttoned or zipped up, it stays done up; if shown open, it stays open), neatly tucked all the way into the waistband of the grey shorts, so no hem is visible below the waistband' where way_key = 'top.tucked';

-- the scarf as a belt stands on its own now
update public.avatar_way set
  needs_way = null,
  shoot_prompt = 'the {piece} from image 2 is rolled into a band and tied around her natural waist like a belt, over the grey tank top, knotted at the front just off-centre with the two ends hanging down over one hip',
  mask_prompt = 'the {piece} tied as a belt, including the knot and both of its hanging ends'
where way_key = 'scarf.belt';

insert into public.avatar_way (way_key, item_types, label, shoot_prompt, mask_prompt, z, needs_way, cinches, is_default, default_rule, sort) values
  ('outer.cinched', array['coat','trench','jacket','blazer','gilet','cape'], 'Cinched',
    'she is wearing the {piece} from image 2 properly with her arms through the sleeves, pulled closed and cinched in at her natural waist by a narrow plain light-grey fabric band tied around the waist over it, so the {piece} wraps her waist and flares below it',
    'the {piece} only, including its sleeves, lapels and collar, but NOT the grey band at the waist', 8, null, null, false, '{"when":"waist_piece_on"}', 41),
  ('top.buttoned', array['shirt','blouse','knitwear'], 'Buttoned',
    'she is wearing the {piece} from image 2 done up, every button fastened from the collar down so it is closed over the grey tank top, hanging loose and untucked so its hem falls over the top of the grey shorts',
    'the {piece}, including its sleeves, cuffs, collar, buttons and hem', 4, null, null, false, null, 12),
  ('top.buttoned_tucked', array['shirt','blouse','knitwear'], 'Buttoned, tucked',
    'she is wearing the {piece} from image 2 done up, every button fastened from the collar down so it is closed over the grey tank top, and neatly tucked all the way into the waistband of the grey shorts so no hem is visible below the waistband',
    'the {piece}, including its sleeves, cuffs, collar and buttons', 2, null, null, false, null, 13),
  ('top.open', array['shirt','blouse','knitwear'], 'Open',
    'she is wearing the {piece} from image 2 worn open and unfastened over the grey tank top, every button undone, hanging loose and untucked so its hem falls over the top of the grey shorts',
    'the {piece}, including its sleeves, cuffs, collar and hem', 4, null, null, false, null, 14),
  ('belt.waist', array['belt'], 'Waist',
    'she is wearing the {piece} from image 2 buckled around her natural waist over the grey tank top',
    'the {piece}, including its buckle and the free end', 7, null, 'outer', true, null, 55)
on conflict (way_key) do nothing;
