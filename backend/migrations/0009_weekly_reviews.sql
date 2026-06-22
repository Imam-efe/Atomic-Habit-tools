-- Weekly review entries
CREATE TABLE IF NOT EXISTS weekly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,           -- YYYY-MM-DD (Monday of that week)
  habit_reflection TEXT,              -- free text: apa yang berhasil?
  obstacle TEXT,                      -- free text: apa hambatannya?
  adjustment TEXT,                    -- free text: apa yang perlu disesuaikan?
  identity_affirmation TEXT,          -- free text: saya adalah orang yang...
  rating INTEGER NOT NULL DEFAULT 3,  -- 1-5 week rating
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user ON weekly_reviews(user_id);
