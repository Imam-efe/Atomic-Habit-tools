-- Add is_two_min column to habit_completions
ALTER TABLE habit_completions ADD COLUMN is_two_min INTEGER DEFAULT 0;
