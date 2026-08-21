-- Habit bundling for temptation bundling (pair desire habit with required habit)
CREATE TABLE IF NOT EXISTS habit_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  required_habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  desire_habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  reward_desc TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, required_habit_id, desire_habit_id)
);

-- Track bundle completions (both required and desire habit done on same day)
CREATE TABLE IF NOT EXISTS bundle_completions (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES habit_bundles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  completion_date TEXT NOT NULL,
  required_completed INTEGER DEFAULT 0,
  desire_completed INTEGER DEFAULT 0,
  both_completed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(bundle_id, completion_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_habit_bundles_user ON habit_bundles(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_bundles_habits ON habit_bundles(required_habit_id, desire_habit_id);
CREATE INDEX IF NOT EXISTS idx_bundle_completions_bundle_date ON bundle_completions(bundle_id, completion_date);
