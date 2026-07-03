-- Feature 1: Recurring budget entries
ALTER TABLE budget_entries ADD COLUMN recurrence TEXT;           -- NULL | 'daily' | 'weekly' | 'monthly'
ALTER TABLE budget_entries ADD COLUMN next_recurrence_date TEXT; -- YYYY-MM-DD, NULL for one-time or generated copies

-- Feature 2: Inventory expiry alert dedup
ALTER TABLE inventory_items ADD COLUMN expiry_alert_sent TEXT;   -- YYYY-MM-DD of last sent alert

-- Feature 3: Net worth monthly snapshots
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  assets INTEGER NOT NULL DEFAULT 0,
  liabilities INTEGER NOT NULL DEFAULT 0,
  net_worth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_net_worth_snapshots_user ON net_worth_snapshots(user_id);
