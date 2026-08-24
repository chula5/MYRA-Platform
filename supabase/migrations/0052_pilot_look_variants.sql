-- VARIANTS PER HERO — style one hero item several ways.
--
-- A "variant group" is a set of looks that share the same hero (anchor) item
-- and answer the member's question "what else can I wear this with?". Each look
-- in the group is an ordinary pilot_look — it approves, swaps and shoots exactly
-- as before; these columns only record which hero it belongs to and which look
-- seeded the group, so the review queue can show them together.
--
-- All nullable: a standalone look (the current default) simply leaves them null.

alter table pilot_look add column if not exists variant_group uuid;
alter table pilot_look add column if not exists hero_item_id text;

-- Looks in one group share a variant_group; querying by it groups the set.
create index if not exists pilot_look_variant_group_idx on pilot_look (variant_group);
