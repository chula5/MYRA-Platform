-- Every private-stylist member is a Chloe client until a persona says otherwise.
--
-- Migration 0052 attributed the members that existed then to Chloe; members
-- created since were inserted with no stylist_id, which meant global-only rules,
-- no Chloe constitution and no stylist-scoped learned rules — looks that
-- started from zero. createMember now sets stylist_id on insert; this brings the
-- existing rows in line. A persona assignment (user_persona) still layers on top.
update pilot_member
set stylist_id = (select stylist_id from stylist where slug = 'chloe' limit 1)
where stylist_id is null;
