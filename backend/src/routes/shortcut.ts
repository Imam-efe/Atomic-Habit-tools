import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';
import { updateHabitStreak } from './habits';

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
// Accepts "Authorization: Bearer <token>" header, or "?token=<token>" query
// param so a Shortcut can work with a single Get Contents of URL action.
async function requireShortcutToken(c: any, next: any) {
  let token = '';
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    token = (c.req.query('token') ?? '').trim();
  }

  if (!token) {
    return c.json({ error: 'unauthorized' }, 401);
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
    'SELECT id, name FROM habits WHERE lower(name) = lower(?1) AND user_id = ?2'
  ).bind(hName, user.id).first()) as { id: string; name: string } | null;

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
    const newStreak = await updateHabitStreak(c.env.DB, habit.id, today);
    return c.json({ success: true, habitName: habit.name, doneToday: false, streak: newStreak });
  } else {
    // Check habit
    const compId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      'INSERT INTO habit_completions (id, habit_id, user_id, completed_date, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(compId, habit.id, user.id, today, now).run();

    const newStreak = await updateHabitStreak(c.env.DB, habit.id, today);
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

// GET /api/shortcut/notifications — Poll queued notification events via iOS Shortcut.
// Returns unconsumed events and marks them consumed, so each event fires once.
// Pass ?peek=1 to read without consuming.
shortcut.get('/notifications', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  const peek = c.req.query('peek') === '1';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 50);

  const events = await c.env.DB.prepare(`
    SELECT id, type, title, body, payload, created_at
    FROM notification_events
    WHERE user_id = ?1 AND consumed = 0
    ORDER BY created_at ASC
    LIMIT ?2
  `).bind(user.id, limit).all<{
    id: string;
    type: string;
    title: string;
    body: string;
    payload: string | null;
    created_at: number;
  }>();

  const rows = events.results ?? [];

  if (!peek && rows.length > 0) {
    const placeholders = rows.map((_, i) => `?${i + 1}`).join(',');
    await c.env.DB.prepare(
      `UPDATE notification_events SET consumed = 1 WHERE id IN (${placeholders})`
    ).bind(...rows.map(r => r.id)).run();
  }

  return c.json({
    count: rows.length,
    notifications: rows.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      payload: r.payload ? JSON.parse(r.payload) : null,
      createdAt: r.created_at,
    })),
  });
});

// Metrik yang diterima dari Apple Health, beserta batas wajarnya.
//
// Batas ini menolak kiriman yang jelas keliru — Automation Shortcuts gampang
// salah satuan (jam vs menit) dan satu angka nyasar akan merusak pencarian pola
// selama berminggu-minggu, dalam diam.
const HEALTH_METRICS: Record<string, { min: number; max: number; label: string }> = {
  sleep_minutes: { min: 0, max: 24 * 60, label: 'menit tidur' },
  steps: { min: 0, max: 200_000, label: 'langkah' },
  resting_hr: { min: 20, max: 220, label: 'detak istirahat' },
  active_energy: { min: 0, max: 20_000, label: 'kalori aktif' },
  weight_kg: { min: 20, max: 400, label: 'berat badan' },
};

// POST /api/shortcut/health — terima metrik Apple Health dari Automation iOS.
//
// Menerima satu metrik ({metric, value}) maupun beberapa sekaligus
// ({metrics: {...}}), karena satu Automation biasanya mengirim tidur, langkah,
// dan detak dalam satu panggilan.
shortcut.post('/health', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  const body = await c.req
    .json<{ date?: string; metric?: string; value?: number; metrics?: Record<string, number> }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'invalid body' }, 400);

  const date = body.date ?? getJakartaToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date harus YYYY-MM-DD' }, 400);
  }

  const incoming: Record<string, number> =
    body.metrics && typeof body.metrics === 'object'
      ? body.metrics
      : body.metric
        ? { [body.metric]: body.value as number }
        : {};

  if (Object.keys(incoming).length === 0) {
    return c.json({ error: 'sertakan metric+value atau metrics' }, 400);
  }

  const saved: string[] = [];
  const rejected: Array<{ metric: string; reason: string }> = [];

  for (const [metric, raw] of Object.entries(incoming)) {
    const spec = HEALTH_METRICS[metric];
    if (!spec) {
      rejected.push({ metric, reason: 'metrik tidak dikenal' });
      continue;
    }

    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      rejected.push({ metric, reason: `${spec.label} harus antara ${spec.min} dan ${spec.max}` });
      continue;
    }

    // Kiriman ulang di hari yang sama menimpa: Automation bisa jalan lebih dari
    // sekali dan angka terakhir yang paling lengkap.
    await c.env.DB.prepare(
      `INSERT INTO health_metrics (user_id, metric_date, metric, value, source, recorded_at)
       VALUES (?1, ?2, ?3, ?4, 'shortcuts', unixepoch())
       ON CONFLICT (user_id, metric_date, metric) DO UPDATE SET
         value = excluded.value, recorded_at = excluded.recorded_at`
    )
      .bind(user.id, date, metric, value)
      .run();

    saved.push(metric);
  }

  return c.json({ date, saved, rejected }, rejected.length > 0 && saved.length === 0 ? 400 : 200);
});

// GET /api/shortcut/health — baca metrik tersimpan, untuk memastikan Automation jalan
shortcut.get('/health', requireShortcutToken, async (c) => {
  const user = c.get('shortcutUser');
  const date = c.req.query('date') ?? getJakartaToday();

  const rows = await c.env.DB.prepare(
    'SELECT metric, value, recorded_at FROM health_metrics WHERE user_id = ?1 AND metric_date = ?2'
  )
    .bind(user.id, date)
    .all<{ metric: string; value: number; recorded_at: number }>();

  return c.json({ date, metrics: rows.results ?? [] });
});

export default shortcut;
