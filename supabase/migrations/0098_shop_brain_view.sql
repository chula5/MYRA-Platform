-- FOR YOU's shop section, kept on the member.
--
-- Building it reads the whole retail library (13s+). It was kept in the Next
-- data cache, which every deploy empties — so the first visit after each
-- deploy waited the full build behind the mirror. Kept here it survives
-- deploys: the page reads one row, and each visit's background rebuild
-- writes the new view back.
alter table pilot_member add column if not exists shop_brain_view jsonb;
alter table pilot_member add column if not exists shop_brain_at timestamptz;
