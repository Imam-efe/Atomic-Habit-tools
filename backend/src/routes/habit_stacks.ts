import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';

const app = new Hono<AuthContext>();

app.use('/*', requireAuth);

// GET /api/habit-stacks - List all stacks for user
app.get('/', async (c) => {
  const user_id = c.get('user').sub;
  const db = c.env.DB;

  const stacks = await db.prepare(`
    SELECT
      hs.id,
      hs.name,
      hs.description,
      hs.is_active,
      hs.sort_order,
      json_group_array(json_object(
        'id', hsi.id,
        'habit_id', hsi.habit_id,
        'position', hsi.position,
        'habit_name', h.name,
        'habit_color', h.color,
        'habit_icon', h.icon,
        'habit_action_time', h.action_time
      )) as habits
    FROM habit_stacks hs
    LEFT JOIN habit_stack_items hsi ON hs.id = hsi.stack_id
    LEFT JOIN habits h ON hsi.habit_id = h.id
    WHERE hs.user_id = ?1
    GROUP BY hs.id
    ORDER BY hs.sort_order ASC, hs.created_at DESC
  `).bind(user_id).all();

  return c.json(stacks.results || []);
});

// POST /api/habit-stacks - Create new stack
app.post('/', async (c) => {
  const user_id = c.get('user').sub;
  const db = c.env.DB;
  const body = await c.req.json() as {
    name: string;
    description?: string;
    habit_ids?: string[];
  };

  if (!body.name?.trim()) {
    return c.json({ error: 'name required' }, 400);
  }

  const habitIds = body.habit_ids || [];
  if (habitIds.length > 0) {
    // Verify all habits belong to user
    const habits = await db.prepare(
      'SELECT id FROM habits WHERE user_id = ?1 AND id IN (' + habitIds.map(() => '?').join(',') + ')'
    ).bind(user_id, ...habitIds).all();

    if ((habits.results?.length || 0) !== habitIds.length) {
      return c.json({ error: 'one or more habits not found' }, 404);
    }
  }

  try {
    const stackId = nanoid();
    const now = Math.floor(Date.now() / 1000);

    await db.prepare(`
      INSERT INTO habit_stacks (id, user_id, name, description, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5)
    `).bind(stackId, user_id, body.name.trim(), body.description || null, now).run();

    // Add habits to stack
    for (let i = 0; i < habitIds.length; i++) {
      await db.prepare(`
        INSERT INTO habit_stack_items (id, stack_id, habit_id, position, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
      `).bind(nanoid(), stackId, habitIds[i], i + 1, now).run();
    }

    return c.json({ id: stackId, success: true });
  } catch (error) {
    console.error('Failed to create habit stack', error);
    throw error;
  }
});

// PUT /api/habit-stacks/:id - Update stack
app.put('/:id', async (c) => {
  const user_id = c.get('user').sub;
  const stack_id = c.req.param('id');
  const db = c.env.DB;
  const body = await c.req.json() as {
    name?: string;
    description?: string;
    is_active?: number;
    habit_ids?: string[];
  };

  const existing = await db.prepare(
    'SELECT id FROM habit_stacks WHERE id = ?1 AND user_id = ?2'
  ).bind(stack_id, user_id).first();

  if (!existing) {
    return c.json({ error: 'stack not found' }, 404);
  }

  try {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name || null);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description || null);
    }
    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active);
    }

    if (updates.length > 0) {
      values.push(stack_id);
      await db.prepare(
        `UPDATE habit_stacks SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values).run();
    }

    // Update habits if provided
    if (body.habit_ids && Array.isArray(body.habit_ids)) {
      const habitIds = body.habit_ids;

      // Verify all habits belong to user
      if (habitIds.length > 0) {
        const habits = await db.prepare(
          'SELECT id FROM habits WHERE user_id = ?1 AND id IN (' + habitIds.map(() => '?').join(',') + ')'
        ).bind(user_id, ...habitIds).all();

        if ((habits.results?.length || 0) !== habitIds.length) {
          return c.json({ error: 'one or more habits not found' }, 404);
        }
      }

      // Delete old items and re-add
      await db.prepare('DELETE FROM habit_stack_items WHERE stack_id = ?1').bind(stack_id).run();

      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < habitIds.length; i++) {
        await db.prepare(`
          INSERT INTO habit_stack_items (id, stack_id, habit_id, position, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5)
        `).bind(nanoid(), stack_id, habitIds[i], i + 1, now).run();
      }
    }

    return c.json({ id: stack_id, success: true });
  } catch (error) {
    console.error('Failed to update habit stack', error);
    throw error;
  }
});

// DELETE /api/habit-stacks/:id - Delete stack
app.delete('/:id', async (c) => {
  const user_id = c.get('user').sub;
  const stack_id = c.req.param('id');
  const db = c.env.DB;

  const existing = await db.prepare(
    'SELECT id FROM habit_stacks WHERE id = ?1 AND user_id = ?2'
  ).bind(stack_id, user_id).first();

  if (!existing) {
    return c.json({ error: 'stack not found' }, 404);
  }

  await db.prepare('DELETE FROM habit_stacks WHERE id = ?1').bind(stack_id).run();
  return c.json({ success: true });
});

export default app;
