-- Dedup marker for the Sunday-evening weekly recap push: stores the Monday
-- date of the week last recapped, so the once-a-minute cron tick only sends
-- one push per user per week during the Sunday 20:00 window.
ALTER TABLE users ADD COLUMN last_weekly_recap_sent TEXT;
