-- Dedup for calendar event reminders: one push per (event, occurrence date).
--
-- A repeating event (daily/weekly/monthly/yearly) needs its reminder to fire
-- once per occurrence, not once ever — a separate table keyed on
-- (event_id, occurrence_date) is what makes "already reminded today's
-- occurrence" and "already reminded next week's occurrence" two different
-- facts, the same way habit_streak_freezes tracks one fact per (habit, day)
-- rather than one flag per habit.
CREATE TABLE IF NOT EXISTS calendar_reminder_sent (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL, -- YYYY-MM-DD
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (event_id, occurrence_date)
);
