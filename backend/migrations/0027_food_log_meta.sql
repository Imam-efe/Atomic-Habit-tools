-- source/barcode metadata for food_logs rows created via the nutrition
-- resolver (search/barcode/label-scan) rather than manual entry.
--
-- A separate table rather than ALTER TABLE food_logs ADD COLUMN — the
-- migrate script re-runs every listed file on every deploy, and SQLite has
-- no ADD COLUMN IF NOT EXISTS (see migrations/README.md). CREATE TABLE
-- IF NOT EXISTS is idempotent, so this can go straight into the script,
-- same pattern as habit_frequency (0020).
--
-- Absence of a row means "manually entered, no source/barcode" — every
-- food_logs row that predates this feature keeps working with zero backfill.
CREATE TABLE IF NOT EXISTS food_log_meta (
  log_id TEXT PRIMARY KEY REFERENCES food_logs(id) ON DELETE CASCADE,
  source TEXT,   -- 'curated' | 'cache-off' | 'cache-ai' | 'off' | 'ai' | 'label-scan'
  barcode TEXT
);
