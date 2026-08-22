-- Streak freeze
--
-- A missed day resets a streak to zero, and losing a 40-day streak to one
-- late night is where people abandon the habit entirely. A freeze bridges a
-- single missed day: the streak survives it, but the frozen day never counts
-- as a completion, so the number stays honest.
--
-- One row per habit per bridged day. The unique index is what makes the
-- once-a-minute cron idempotent — a second grant for the same day is rejected
-- rather than silently doubling the quota.

CREATE TABLE IF NOT EXISTS habit_streak_freezes (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freeze_date TEXT NOT NULL,  -- YYYY-MM-DD, the missed day being bridged
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_freeze_habit_date
  ON habit_streak_freezes(habit_id, freeze_date);

CREATE INDEX IF NOT EXISTS idx_freeze_user_date
  ON habit_streak_freezes(user_id, freeze_date);
