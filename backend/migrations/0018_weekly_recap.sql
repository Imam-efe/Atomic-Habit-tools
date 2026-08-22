-- NOT in db:migrate — ALTER TABLE ADD COLUMN is not idempotent, and the
-- script re-runs every listed file on each deploy. Already applied to
-- production by hand. See README.md in this directory.
-- Dedup marker for the Sunday-evening weekly recap push: stores the Monday
-- date of the week last recapped, so the once-a-minute cron tick only sends
-- one push per user per week during the Sunday 20:00 window.
ALTER TABLE users ADD COLUMN last_weekly_recap_sent TEXT;
