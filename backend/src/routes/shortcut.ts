import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

type ShortcutContext = {
  Variables: {
    shortcutUser: { id: string };
  };
  Bindings: AuthContext['Bindings'];
};

const shortcut = new Hono<ShortcutContext>();

// Helper to get today's date in GMT+7 (Jakarta)
function getJakartaToday() {
  const now = new Date();
  const jakartaTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return jakartaTime.toISOString().slice(0, 10);
}

// Middleware for token-based authentication (iOS Shortcuts calls)
async function requireShortcutToken(c: any, next: any) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return c.json({ error: 'invalid token format' }, 401);
  }

  const tokenRow = (await c.env.DB.prepare(
    'SELECT user_id FROM shortcut_tokens WHERE token = ?1'
  ).bind(token).first()) as { user_id: string } | null;

  if (!tokenRow) {
    return c.json({ error: 'invalid or revoked API token' }, 401);
  }

  c.set('shortcutUser', { id: tokenRow.user_id });
  await next();
}

// ---------------------
// 1. Web App API Endpoints (Uses standard JWT authentication)
// ---------------------

// GET /api/shortcut/token — Get current shortcut API token
shortcut.get('/token', requireAuth, async (c) => {
  const user = c.get('user');
  const row = (await c.env.DB.prepare(
    'SELECT token, created_at FROM shortcut_tokens WHERE user_id = ?1'
  ).bind(user.sub).first()) as { token: string; created_at: number } | null;

  if (!row) {
    return c.json({ token: null });
  }
  return c.json({ token: row.token, createdAt: row.created_at });
});

// POST /api/shortcut/token/regenerate — Generate a new API token
shortcut.post('/token/regenerate', requireAuth, async (c) => {
  const user = c.get('user');
  const newToken = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO shortcut_tokens (id, user_id, token, label, created_at)
    VALUES (
      COALESCE((SELECT id FROM shortcut_tokens WHERE user_id = ?2), ?1),
      ?2, ?3, 'iPhone Shortcut', ?4
    )
  `).bind(nanoid(), user.sub, newToken, now).run();

  return c.json({ token: newToken, createdAt: now });
});

// ---------------------
// 2. Shortcuts Integration Endpoints (Uses Bearer API Token)
// ---------------------

// POST /api/shortcut/tasks — Create a task in a project via iOS Shortcut
shortcut.post('/tasks', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  type TaskBody = { projectName?: string; taskName?: string };
  const body = await c.req.json<TaskBody>().catch((): TaskBody => ({}));

  const pName = (body.projectName ?? 'Inbox').trim();
  const tName = (body.taskName ?? '').trim();

  const taskErr = validate({ taskName: tName }, { taskName: { type: 'string' } });
  if (taskErr) return c.json({ error: taskErr }, 400);

  // 1. Find or create the project
  let project = (await c.env.DB.prepare(
    'SELECT id FROM projects WHERE lower(name) = lower(?1) AND user_id = ?2'
  ).bind(pName, user.id).first()) as { id: string } | null;

  let projectId = project?.id;
  const now = Math.floor(Date.now() / 1000);

  if (!projectId) {
    projectId = nanoid();
    await c.env.DB.prepare(
      'INSERT INTO projects (id, user_id, name, created_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(projectId, user.id, pName, now).run();
  }

  // 2. Insert the task
  const taskId = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO tasks (id, project_id, user_id, name, status, sort_order, created_at)
    VALUES (?1, ?2, ?3, ?4, 'backlog', 0, ?5)
  `).bind(taskId, projectId, user.id, tName, now).run();

  return c.json({ success: true, taskId, projectId, projectName: pName });
});

// POST /api/shortcut/habits/toggle — Complete/Uncheck a habit via iOS Shortcut
shortcut.post('/habits/toggle', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  type HabitBody = { habitName?: string };
  const body = await c.req.json<HabitBody>().catch((): HabitBody => ({}));

  const hName = (body.habitName ?? '').trim();
  const habitErr = validate({ habitName: hName }, { habitName: { type: 'string' } });
  if (habitErr) return c.json({ error: habitErr }, 400);

  // Find habit by name
  const habit = (await c.env.DB.prepare(
    'SELECT id, name, streak, last_completed_date FROM habits WHERE lower(name) = lower(?1) AND user_id = ?2'
  ).bind(hName, user.id).first()) as { id: string; name: string; streak: number; last_completed_date: string | null } | null;

  if (!habit) {
    return c.json({ error: `Habit "${hName}" not found` }, 404);
  }

  const today = getJakartaToday();

  // Check if already completed today
  const existing = (await c.env.DB.prepare(
    'SELECT id FROM habit_completions WHERE habit_id = ?1 AND completed_date = ?2'
  ).bind(habit.id, today).first()) as { id: string } | null;

  if (existing) {
    // Uncheck habit
    await c.env.DB.prepare('DELETE FROM habit_completions WHERE id = ?1').bind(existing.id).run();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayDone = await c.env.DB.prepare(
      'SELECT id FROM habit_completions WHERE habit_id = ?1 AND completed_date = ?2'
    ).bind(habit.id, yesterday).first();

    const newStreak = yesterdayDone ? Math.max(0, habit.streak - 1) : 0;
    await c.env.DB.prepare('UPDATE habits SET streak = ?1, last_completed_date = ?2 WHERE id = ?3')
      .bind(newStreak, yesterdayDone ? yesterday : null, habit.id).run();

    return c.json({ success: true, habitName: habit.name, doneToday: false, streak: newStreak });
  } else {
    // Check habit
    const compId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      'INSERT INTO habit_completions (id, habit_id, user_id, completed_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(compId, habit.id, user.id, today, now).run();

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newStreak = habit.last_completed_date === yesterday ? habit.streak + 1 : 1;
    await c.env.DB.prepare('UPDATE habits SET streak = ?1, last_completed_date = ?2 WHERE id = ?3')
      .bind(newStreak, today, habit.id).run();

    return c.json({ success: true, habitName: habit.name, doneToday: true, streak: newStreak });
  }
});

// POST /api/shortcut/budget — Log a financial transaction via iOS Shortcut
shortcut.post('/budget', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  type BudgetBody = { type?: 'income' | 'expense'; amount?: number; category?: string; note?: string };
  const body = await c.req.json<BudgetBody>().catch((): BudgetBody => ({}));

  const budgetErr = validate(body as Record<string, unknown>, { amount: { type: 'number', min: 1 } });
  if (budgetErr) return c.json({ error: budgetErr }, 400);

  const type = body.type || 'expense';
  const amount = body.amount!;
  const note = (body.note ?? '').trim();
  const today = getJakartaToday();

  const category = (body.category ?? (type === 'expense' ? 'Lainnya' : 'Freelance')).trim();

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(`
    INSERT INTO budget_entries (id, user_id, type, amount_idr, category, note, entry_date, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.id,
    type,
    amount,
    category,
    note || null,
    today,
    now
  ).run();

  return c.json({ success: true, entryId: id, type, amount, category, date: today });
});

export default shortcut;
