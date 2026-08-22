-- Calendar: user-created tasks, events and reminders on a date.
--
-- National holidays are NOT stored here. They are the same for every user and
-- change only by government decree, so they ship as bundled data in the client
-- rather than as rows nobody edits.
--
-- event_date / event_time are Jakarta wall-clock (GMT+7), matching the rest of
-- the schema. event_date is the date the entry belongs to; for a repeating
-- entry it is the first occurrence.
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  note TEXT,

  -- task | event | reminder | milestone
  kind TEXT NOT NULL DEFAULT 'task',

  event_date TEXT NOT NULL,       -- YYYY-MM-DD
  event_time TEXT,                -- HH:MM, NULL = sepanjang hari
  end_time TEXT,                  -- HH:MM

  -- low | normal | high
  priority TEXT NOT NULL DEFAULT 'normal',
  color TEXT,

  is_done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,

  -- none | daily | weekly | monthly | yearly
  repeat_rule TEXT NOT NULL DEFAULT 'none',
  repeat_until TEXT,              -- YYYY-MM-DD, NULL = tanpa batas

  -- Minutes before the entry to notify. NULL = tidak mengingatkan.
  remind_minutes_before INTEGER,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The month view asks for one user's entries in a date range, which is the
-- only read path that matters here.
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_date
  ON calendar_events(user_id, event_date);

-- Repeating entries are matched by rule, not by date, so they need their own
-- path — a yearly entry from 2020 still has to surface in 2026.
CREATE INDEX IF NOT EXISTS idx_calendar_events_repeat
  ON calendar_events(user_id, repeat_rule);
