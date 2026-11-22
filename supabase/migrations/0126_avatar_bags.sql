-- 0126 · AVATAR: bags (Chloe, 2026-11-16: "the dressing room has no bags at all").
--
-- Three ways, family 'bag', drawn over everything (z 10) because a bag hangs over the
-- jacket. All three are defaults, each for its own kinds of bag (default_rule.default_for,
-- read by lib/avatar/way-default.ts): a clutch or top-handle bag in her hand, a shoulder bag
-- or tote on her shoulder, a crossbody across her body. Owned bags are queued in their
-- default way only; the other ways and saved bags are shot when she taps them.
--
-- Each shot is on the plain base with her arm left where it hangs, so the layer stacks on
-- any outfit. The held way's mask takes the hand that grips it, so the layer's hand replaces
-- the base's.

insert into public.avatar_way (way_key, item_types, label, shoot_prompt, mask_prompt, z, needs_way, cinches, is_default, default_rule, sort) values
  ('bag.shoulder', array['shoulder_bag','tote','structured_bag','crossbody'], 'On the shoulder',
    'the {piece} from image 2 hangs from her right shoulder (on the left of the picture) by its strap or handles, the bag itself resting against the side of her right hip just in front of her hanging arm, at its true size against her body; both arms still hang relaxed at her sides exactly as in image 1',
    'the {piece}, including the whole of its strap or handles up and over her shoulder', 10, null, null, true, '{"default_for":["shoulder_bag","tote"]}', 70),
  ('bag.hand', array['clutch','structured_bag','tote','shoulder_bag'], 'In the hand',
    'she holds the {piece} from image 2 in her right hand (on the left of the picture): by its top handle if it has one, otherwise gripped along its top edge like a clutch, her arm still hanging relaxed at her side exactly as in image 1 so the bag hangs beside her thigh, at its true size against her body',
    'the {piece}, including its handle, TOGETHER WITH the whole right hand and fingers holding it', 10, null, null, true, '{"default_for":["clutch","structured_bag"]}', 71),
  ('bag.crossbody', array['crossbody','shoulder_bag'], 'Across the body',
    'the {piece} from image 2 is worn crossbody: its strap runs from her left shoulder diagonally across her chest to the bag resting at her right hip (on the left of the picture), at its true size against her body; both arms still hang relaxed at her sides exactly as in image 1',
    'the {piece}, including the whole length of its strap across her chest and over her shoulder', 10, null, null, true, '{"default_for":["crossbody"]}', 72)
on conflict (way_key) do update set
  item_types = excluded.item_types, label = excluded.label, shoot_prompt = excluded.shoot_prompt, mask_prompt = excluded.mask_prompt,
  z = excluded.z, is_default = excluded.is_default, default_rule = excluded.default_rule, sort = excluded.sort, active = true;
-- (the ways may already be here, inactive, from the two test shots on Chloe's avatar: this switches them on)
