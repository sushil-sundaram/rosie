-- Recurring chores/bills: 'weekly' | 'monthly' | 'yearly'.
-- repeat_day keeps the original day of month so 31st -> 28 Feb -> 31 Mar doesn't drift.
-- next_id links to the occurrence created when this one was completed.
ALTER TABLE chores ADD COLUMN repeat TEXT;
ALTER TABLE chores ADD COLUMN repeat_day INTEGER;
ALTER TABLE chores ADD COLUMN next_id INTEGER;
