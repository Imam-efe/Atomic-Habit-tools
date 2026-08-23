-- Quick free-text notes. No forced title field — the same convention as
-- most notes apps: the first line of the body IS the title, computed by
-- the frontend rather than stored twice.
--
-- summary is AI-generated on request (POST /:id/summarize), never on save —
-- jotting a note should never wait on a network round trip. NULL until the
-- user asks for it.
--
-- linked_habit_id / linked_goal_id are optional context, same idea as a
-- habit's goal_ids: a note about "kenapa aku skip lari hari ini" is more
-- useful attached to the Olahraga habit than floating free.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  summary TEXT,
  linked_habit_id TEXT REFERENCES habits(id) ON DELETE SET NULL,
  linked_goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes(user_id, created_at DESC);
