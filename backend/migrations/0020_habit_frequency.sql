-- Habit frequency: "daily" (default, no row) or "weekly" (N times per week).
--
-- A separate table rather than ALTER TABLE habits ADD COLUMN — the migrate
-- script re-runs every listed file on every deploy, and SQLite has no
-- ADD COLUMN IF NOT EXISTS (see migrations/README.md). CREATE TABLE
-- IF NOT EXISTS is idempotent, so this can go straight into the script.
--
-- Absence of a row means daily: every habit that existed before this
-- migration keeps its exact current behavior with zero backfill needed.
CREATE TABLE IF NOT EXISTS habit_frequency (
  habit_id TEXT PRIMARY KEY REFERENCES habits(id) ON DELETE CASCADE,
  frequency_type TEXT NOT NULL DEFAULT 'daily', -- 'daily' | 'weekly'
  target_per_week INTEGER,                       -- 1-6 when weekly, NULL when daily
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
