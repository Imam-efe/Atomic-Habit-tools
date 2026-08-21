-- Notification Center: user-defined push reminders with flexible scheduling.
-- All wall-clock fields (time_of_day, quiet_from, quiet_to) are Jakarta time (GMT+7).
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,

  -- once | interval | daily | weekly
  schedule_type TEXT NOT NULL,
  time_of_day TEXT,           -- HH:MM — daily / weekly
  days_of_week TEXT,          -- '1,2,3,4,5' where 1=Mon .. 7=Sun — weekly
  interval_minutes INTEGER,   -- interval
  run_at INTEGER,             -- unix seconds — once

  -- Quiet window, applies to interval schedules so they never fire overnight
  quiet_from TEXT,            -- HH:MM
  quiet_to TEXT,              -- HH:MM

  max_occurrences INTEGER,    -- NULL = unlimited
  fired_count INTEGER NOT NULL DEFAULT 0,

  next_run_at INTEGER,        -- NULL = finished; precomputed so cron does an index scan
  last_fired_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due ON scheduled_notifications(is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_user ON scheduled_notifications(user_id, created_at);

-- Delivery history, for the "Riwayat" list and for debugging silent notifications
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT REFERENCES scheduled_notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,       -- sent | failed | no_subscription
  detail TEXT,
  fired_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries(user_id, fired_at);
