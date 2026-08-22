-- Dedup flag for the streak-at-risk evening nudge, mirrors inventory_items.expiry_alert_sent:
-- one push per habit per day even though the cron tick that finds it due repeats every minute.
ALTER TABLE habits ADD COLUMN streak_alert_sent TEXT;
