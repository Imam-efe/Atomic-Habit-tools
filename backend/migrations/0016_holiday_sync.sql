-- Cached holiday data pulled from an upstream source.
--
-- This does NOT replace the bundled dataset in the client. The upstream source
-- agrees with the SKB on every 2026 date but is less precise about what each
-- one is: it marks cuti bersama as an ordinary holiday, so 28 May 2026 comes
-- through as a second day of Idul Adha rather than the joint leave it actually
-- is. Overwriting the bundle with it would lose the libur/cuti distinction the
-- calendar draws in two different colours.
--
-- So the cache has two jobs:
--   1. cover years the bundle has no decree for yet, flagged unverified;
--   2. record disagreement with the bundle so a real change to the decree is
--      noticed instead of silently repainting red dates.
--
-- Rows are global, not per-user: a national holiday is the same for everyone.
CREATE TABLE IF NOT EXISTS holiday_cache (
  holiday_date TEXT PRIMARY KEY,   -- YYYY-MM-DD
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  -- libur | cuti — inferred from the name upstream, so treat as a hint
  kind TEXT NOT NULL DEFAULT 'libur',
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_holiday_cache_year ON holiday_cache(year);

-- One row per sync attempt outcome, so the UI can show when the data was last
-- confirmed fresh and whether the last run actually succeeded.
CREATE TABLE IF NOT EXISTS holiday_sync_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source TEXT NOT NULL,
  -- The upstream's own "last updated" marker, when it publishes one.
  source_updated TEXT,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  -- ok | error
  status TEXT,
  detail TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0
);
