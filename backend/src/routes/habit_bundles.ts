import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';

const app = new Hono<AuthContext>();

app.use('/*', requireAuth);

// GET /api/habit-bundles - List all bundles for user
app.get('/', async (c) => {
  const user_id = c.get('user').sub;
  const db = c.env.DB;

  const bundles = await db.prepare(`
    SELECT
      hb.id,
      hb.required_habit_id,
      hb.desire_habit_id,
      hb.reward_desc,
      hb.is_active,
      rh.name as required_habit_name,
      dh.name as desire_habit_name,
      COUNT(bc.id) as total_completions,
      SUM(CASE WHEN bc.both_completed = 1 THEN 1 ELSE 0 END) as both_completed_count
    FROM habit_bundles hb
    LEFT JOIN habits rh ON hb.required_habit_id = rh.id
    LEFT JOIN habits dh ON hb.desire_habit_id = dh.id
    LEFT JOIN bundle_completions bc ON hb.id = bc.bundle_id
    WHERE hb.user_id = ?1
    GROUP BY hb.id
    ORDER BY hb.created_at DESC
  `).bind(user_id).all();

  return c.json(bundles.results || []);
});

// POST /api/habit-bundles - Create new bundle
app.post('/', async (c) => {
  const user_id = c.get('user').sub;
  const db = c.env.DB;
  const body = await c.req.json() as {
    required_habit_id: string;
    desire_habit_id: string;
    reward_desc?: string;
  };

  if (!body.required_habit_id || !body.desire_habit_id) {
    return c.json({ error: 'required_habit_id and desire_habit_id required' }, 400);
  }

  if (body.required_habit_id === body.desire_habit_id) {
    return c.json({ error: 'cannot bundle habit with itself' }, 400);
  }

  const owned = await db.prepare(
    'SELECT id FROM habits WHERE id IN (?1, ?2) AND user_id = ?3'
  ).bind(body.required_habit_id, body.desire_habit_id, user_id).all();

  if ((owned.results?.length ?? 0) !== 2) {
    return c.json({ error: 'habit not found' }, 404);
  }

  try {
    const id = nanoid();
    await db.prepare(`
      INSERT INTO habit_bundles (id, user_id, required_habit_id, desire_habit_id, reward_desc)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(id, user_id, body.required_habit_id, body.desire_habit_id, body.reward_desc || null).run();

    return c.json({ id, success: true });
  } catch (error) {
    if ((error as any).message?.includes('UNIQUE')) {
      return c.json({ error: 'bundle already exists for these habits' }, 409);
    }
    throw error;
  }
});

// PUT /api/habit-bundles/:id - Update bundle
app.put('/:id', async (c) => {
  const user_id = c.get('user').sub;
  const id = c.req.param('id');
  const db = c.env.DB;
  const body = await c.req.json() as {
    reward_desc?: string;
    is_active?: number;
  };

  const existing = await db.prepare(
    'SELECT id FROM habit_bundles WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user_id).first();

  if (!existing) {
    return c.json({ error: 'bundle not found' }, 404);
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.reward_desc !== undefined) {
    updates.push('reward_desc = ?');
    values.push(body.reward_desc || null);
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    values.push(body.is_active);
  }

  if (updates.length === 0) {
    return c.json({ id, success: true });
  }

  values.push(id);
  await db.prepare(
    `UPDATE habit_bundles SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ id, success: true });
});

// DELETE /api/habit-bundles/:id - Delete bundle
app.delete('/:id', async (c) => {
  const user_id = c.get('user').sub;
  const id = c.req.param('id');
  const db = c.env.DB;

  const existing = await db.prepare(
    'SELECT id FROM habit_bundles WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user_id).first();

  if (!existing) {
    return c.json({ error: 'bundle not found' }, 404);
  }

  await db.prepare('DELETE FROM habit_bundles WHERE id = ?1').bind(id).run();
  return c.json({ success: true });
});

// GET /api/habit-bundles/:id/completions - Get bundle completion history
app.get('/:id/completions', async (c) => {
  const user_id = c.get('user').sub;
  const id = c.req.param('id');
  const db = c.env.DB;

  const bundle = await db.prepare(
    'SELECT id FROM habit_bundles WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user_id).first();

  if (!bundle) {
    return c.json({ error: 'bundle not found' }, 404);
  }

  const completions = await db.prepare(`
    SELECT
      completion_date,
      required_completed,
      desire_completed,
      both_completed
    FROM bundle_completions
    WHERE bundle_id = ?1
    ORDER BY completion_date DESC
    LIMIT 90
  `).bind(id).all();

  return c.json(completions.results || []);
});

// POST /api/habit-bundles/:id/check - Mark both habits completed today
app.post('/:id/check', async (c) => {
  const user_id = c.get('user').sub;
  const id = c.req.param('id');
  const db = c.env.DB;
  const today = jakartaToday();

  const bundle = await db.prepare(
    'SELECT required_habit_id, desire_habit_id FROM habit_bundles WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user_id).first<{ required_habit_id: string; desire_habit_id: string }>();

  if (!bundle) {
    return c.json({ error: 'bundle not found' }, 404);
  }

  // Check if both habits completed today
  const [reqCheck, desireCheck] = await Promise.all([
    db.prepare(
      'SELECT id FROM habit_completions WHERE habit_id = ?1 AND completed_date = ?2 AND user_id = ?3'
    ).bind(bundle.required_habit_id, today, user_id).first(),
    db.prepare(
      'SELECT id FROM habit_completions WHERE habit_id = ?1 AND completed_date = ?2 AND user_id = ?3'
    ).bind(bundle.desire_habit_id, today, user_id).first()
  ]);

  const bothCompleted = reqCheck && desireCheck ? 1 : 0;

  const completionId = nanoid();
  await db.prepare(`
    INSERT OR REPLACE INTO bundle_completions
    (id, bundle_id, user_id, completion_date, required_completed, desire_completed, both_completed)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    completionId,
    id,
    user_id,
    today,
    reqCheck ? 1 : 0,
    desireCheck ? 1 : 0,
    bothCompleted
  ).run();

  return c.json({
    success: true,
    completion_date: today,
    required_completed: !!reqCheck,
    desire_completed: !!desireCheck,
    both_completed: bothCompleted === 1,
  });
});

export default app;
