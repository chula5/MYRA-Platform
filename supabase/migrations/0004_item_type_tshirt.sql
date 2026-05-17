-- Adds 't-shirt' to item_type_enum.
--
-- The dropdown in /admin/items/new (and the TypeScript ItemType union) lists
-- 't-shirt' as a valid top type, but the database enum was created without it.
-- Selecting t-shirt and saving the form throws:
--   invalid input value for enum item_type_enum: "t-shirt"
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent — safe to re-run on any
-- environment. The new value becomes usable as soon as this migration commits.
ALTER TYPE item_type_enum ADD VALUE IF NOT EXISTS 't-shirt';
