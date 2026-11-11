-- 0122 · AVATAR: a top worn OPEN is worn by itself.
--
-- top.open was shot "open over the grey tank top", so an open cardigan on her
-- avatar showed the base's grey tank between its fronts (2026-11-09, Chloe:
-- "this cardigan is worn by itself"). The open way now removes the tank and
-- shows a narrow V of skin between the fronts, and its mask takes that V too,
-- so the layer replaces the tank rather than framing it.

update public.avatar_way set
  shoot_prompt = 'she is wearing the {piece} from image 2 worn by itself, open and unfastened with nothing underneath it: the grey tank top is removed, every button undone, the two fronts hanging loose and untucked over the top of the grey shorts, a narrow V of her bare skin showing between the fronts from the collarbones down, her chest covered by the fronts',
  mask_prompt = 'the {piece}, including its sleeves, cuffs, collar and hem, TOGETHER WITH the skin showing between its open fronts, so that everything from her shoulders down to the hem of the piece, between its two outer edges, is covered'
where way_key = 'top.open';
