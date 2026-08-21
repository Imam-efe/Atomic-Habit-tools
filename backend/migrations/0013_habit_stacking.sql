-- Habit Stacking: Chain habits in sequence (morning routine, etc)
CREATE TABLE habit_stacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Habits in a stack, ordered
CREATE TABLE habit_stack_items (
  id TEXT PRIMARY KEY,
  stack_id TEXT NOT NULL REFERENCES habit_stacks(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(stack_id, habit_id),
  UNIQUE(stack_id, position)
);

CREATE INDEX idx_habit_stacks_user ON habit_stacks(user_id);
CREATE INDEX idx_habit_stack_items_stack ON habit_stack_items(stack_id);
CREATE INDEX idx_habit_stack_items_habit ON habit_stack_items(habit_id);
