-- Cached AI narrative recap per user per month. Regenerated on demand
-- (POST /api/monthly-review/generate), not on every view, so a plain GET
-- never spends AI neurons.
CREATE TABLE IF NOT EXISTS monthly_reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM
  narrative TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_monthly_reviews_user_month ON monthly_reviews(user_id, month DESC);
