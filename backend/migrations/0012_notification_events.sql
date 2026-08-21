-- Queue of notification events for external consumers (iOS Shortcuts polling)
CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- 'habit_reminder' | 'expiry_alert' | ...
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload TEXT,                  -- JSON extras (habitName, url, ...)
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_consumed
  ON notification_events(user_id, consumed, created_at);
