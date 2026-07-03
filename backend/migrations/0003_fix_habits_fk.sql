PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS habits;

CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#34C759',
  icon TEXT NOT NULL DEFAULT 'check',
  trigger_cue TEXT,
  action_desc TEXT,
  action_time TEXT,
  action_place TEXT,
  two_min TEXT,
  streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  milestone INTEGER NOT NULL DEFAULT 7,
  goal_ids TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);

PRAGMA foreign_keys = ON;
