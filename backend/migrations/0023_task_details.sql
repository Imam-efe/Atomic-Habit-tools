-- Due date and priority for tasks — a separate table rather than
-- ALTER TABLE tasks ADD COLUMN, same reasoning as habit_frequency: the
-- migrate script re-runs every listed file on every deploy, and SQLite has
-- no ADD COLUMN IF NOT EXISTS. Absence of a row means "no due date, normal
-- priority", so every existing task is unaffected with zero backfill.
CREATE TABLE IF NOT EXISTS task_details (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  due_date TEXT,                          -- YYYY-MM-DD, NULL = no due date
  priority TEXT NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high'
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
