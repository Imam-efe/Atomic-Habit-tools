CREATE TABLE IF NOT EXISTS menstrual_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cycle_length INTEGER NOT NULL DEFAULT 28,
  period_length INTEGER NOT NULL DEFAULT 5,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS menstrual_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL, -- YYYY-MM-DD
  end_date TEXT,            -- YYYY-MM-DD (opsional)
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS shortcut_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'iPhone Shortcut',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_menstrual_logs_user ON menstrual_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_shortcut_tokens_token ON shortcut_tokens(token);
