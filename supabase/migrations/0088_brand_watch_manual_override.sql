-- Manual override + keep-everything, for Brand Watch automation.
--
-- Two things the earned-trust gate could not express:
--
--  · auto_keep_manual — Chloe's explicit decision to switch a brand on before
--    the gate has been earned. The gate needs a COUNT of predictions at her
--    bar, not just accuracy, so LIFNER (16 of 16 right) and AFLALO (22 of 22)
--    sat locked while being perfect, and Léméls and Liberowe stayed locked
--    because the model is never sure enough about their pieces at any bar.
--    Switching a level on while untrusted sets this, and the card says so.
--
--  · auto_keep_all — keep every new piece this brand queues, in season. For a
--    brand whose taste does not need predicting. The season rule still applies,
--    so outgoing summer stock is still left in the queue.

alter table watched_brand
  add column if not exists auto_keep_manual boolean not null default false;

alter table watched_brand
  add column if not exists auto_keep_all boolean not null default false;

alter table watched_brand
  add column if not exists auto_keep_all_since timestamptz;
