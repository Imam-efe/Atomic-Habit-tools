import { Hono } from 'hono';
import type { HabitRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, jakartaToday } from '../lib/validate';

const habits = new Hono<AuthContext>();

habits.use('/*', requireAuth);

async function syncGoalHabitRelations(db: D1Database, userId: string) {
  const [goalsRes, habitsRes] = await Promise.all([
    db.prepare('SELECT id FROM goals WHERE user_id = ?1').bind(userId).all<{ id: string }>(),
    db.prepare('SELECT id, goal_ids FROM habits WHERE user_id = ?1').bind(userId).all<{ id: string; goal_ids: string }>()
  ]);

  const goals = goalsRes.results ?? [];
  const habitsList = habitsRes.results ?? [];

  const batch = [];
  for (const g of goals) {
    const linkedHabitIds = habitsList
      .filter((h: any) => {
        try {
          const arr = JSON.parse(h.goal_ids ?? '[]');
          return Array.isArray(arr) && arr.includes(g.id);
        } catch {
          return false;
        }
      })
      .map((h: any) => h.id);

    batch.push(
      db.prepare('UPDATE goals SET habit_ids = ?1 WHERE id = ?2').bind(JSON.stringify(linkedHabitIds), g.id)
    );
  }

  if (batch.length > 0) {
    await db.batch(batch);
  }
}


function getAdjacentDate(dateStr: string, offset: number): string {
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function updateHabitStreak(db: D1Database, habitId: string, today: string): Promise<number> {
  const completions = await db.prepare(
    'SELECT completed_date, is_two_min FROM habit_completions WHERE habit_id = ?1 ORDER BY completed_date DESC'
  ).bind(habitId).all<{ completed_date: string; is_two_min: number }>();

  const completionsList = completions.results ?? [];
  const dateMap = new Map(completionsList.map(c => [c.completed_date, c.is_two_min === 1]));

  let streak = 0;
  let lastCompletedDate: string | null = null;

  if (completionsList.length > 0) {
    lastCompletedDate = completionsList[0].completed_date;
  }

  if (dateMap.has(today)) {
    let checkDate = today;
    while (true) {
      if (dateMap.has(checkDate)) {
        streak++;
        checkDate = getAdjacentDate(checkDate, -1);
      } else {
        const nextDateStr = getAdjacentDate(checkDate, 1);
        if (dateMap.get(nextDateStr) === true) {
          checkDate = getAdjacentDate(checkDate, -1);
          if (dateMap.has(checkDate)) {
            continue;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
  } else {
    const yesterday = getAdjacentDate(today, -1);
    let checkDate = yesterday;
    while (true) {
      if (dateMap.has(checkDate)) {
        streak++;
        checkDate = getAdjacentDate(checkDate, -1);
      } else {
        const nextDateStr = getAdjacentDate(checkDate, 1);
        if (dateMap.get(nextDateStr) === true) {
          checkDate = getAdjacentDate(checkDate, -1);
          if (dateMap.has(checkDate)) {
            continue;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
  }

  await db.prepare('UPDATE habits SET streak = ?1, last_completed_date = ?2 WHERE id = ?3')
    .bind(streak, lastCompletedDate, habitId).run();

  return streak;
}

// GET /api/habits — list habits with today's completion status
habits.get('/', async (c) => {
  const user = c.get('user');
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const rows = await c.env.DB.prepare(
    'SELECT * FROM habits WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC'
  ).bind(user.sub).all<HabitRow>();

  const completions = await c.env.DB.prepare(
    'SELECT habit_id, is_two_min FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2'
  ).bind(user.sub, today).all<{ habit_id: string; is_two_min: number }>();

  const completionsMap = new Map(completions.results.map(r => [r.habit_id, r.is_two_min === 1]));

  const result = (rows.results ?? []).map(h => ({
    id: h.id,
    name: h.name,
    color: h.color,
    icon: h.icon,
    triggerCue: h.trigger_cue,
    twoMin: h.two_min,
    streak: h.streak,
    milestone: h.milestone,
    goalIds: JSON.parse(h.goal_ids ?? '[]'),
    doneToday: completionsMap.has(h.id),
    isTwoMinToday: completionsMap.get(h.id) ?? false,
    reminderTime: h.action_time,
  }));

  return c.json(result);
});

// POST /api/habits — create habit
habits.post('/', async (c) => {
  const user = c.get('user');
  type HabitBody = { name?: string; color?: string; triggerCue?: string; twoMin?: string; goalIds?: string[]; reminderTime?: string };
  const body = await c.req.json<HabitBody>().catch((): HabitBody => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const goalIdsStr = JSON.stringify(body.goalIds ?? []);

  await c.env.DB.prepare(
    `INSERT INTO habits (id, user_id, name, color, icon, trigger_cue, two_min, goal_ids, created_at, action_time)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    id, user.sub,
    (body.name || '').trim(),
    body.color ?? '#34C759',
    'check',
    body.triggerCue?.trim() ?? null,
    body.twoMin?.trim() ?? null,
    goalIdsStr,
    now,
    body.reminderTime?.trim() ?? null
  ).run();

  await syncGoalHabitRelations(c.env.DB, user.sub);

  return c.json({ id, name: (body.name || '').trim(), color: body.color ?? '#34C759', streak: 0, doneToday: false, isTwoMinToday: false, goalIds: body.goalIds ?? [], reminderTime: body.reminderTime?.trim() ?? null }, 201);
});


// POST /api/habits/:id/toggle — check/uncheck habit for today
habits.post('/:id/toggle', async (c) => {
  const user = c.get('user');
  const habitId = c.req.param('id');
  const today = new Date().toISOString().slice(0, 10);
  
  type ToggleBody = { isTwoMin?: boolean };
  const body = await c.req.json<ToggleBody>().catch((): ToggleBody => ({}));
  const isTwoMin = !!body.isTwoMin;

  // verify ownership
  const habit = await c.env.DB.prepare(
    'SELECT id FROM habits WHERE id = ?1 AND user_id = ?2'
  ).bind(habitId, user.sub).first<{ id: string }>();
  if (!habit) return c.json({ error: 'not found' }, 404);

  const existing = await c.env.DB.prepare(
    'SELECT id, is_two_min FROM habit_completions WHERE habit_id = ?1 AND completed_date = ?2'
  ).bind(habitId, today).first<{ id: string; is_two_min: number }>();

  if (existing) {
    // If the user specifies isTwoMin and it differs from current completion type, update it instead of deleting
    if (body.isTwoMin !== undefined && isTwoMin !== (existing.is_two_min === 1)) {
      await c.env.DB.prepare('UPDATE habit_completions SET is_two_min = ?1 WHERE id = ?2')
        .bind(isTwoMin ? 1 : 0, existing.id).run();
      const newStreak = await updateHabitStreak(c.env.DB, habitId, today);
      return c.json({ doneToday: true, streak: newStreak, isTwoMinToday: isTwoMin });
    } else {
      // Regular undo
      await c.env.DB.prepare('DELETE FROM habit_completions WHERE id = ?1').bind(existing.id).run();
      const newStreak = await updateHabitStreak(c.env.DB, habitId, today);
      return c.json({ doneToday: false, streak: newStreak, isTwoMinToday: false });
    }
  } else {
    // complete
    const compId = nanoid();
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      'INSERT INTO habit_completions (id, habit_id, user_id, completed_date, is_two_min, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    ).bind(compId, habitId, user.sub, today, isTwoMin ? 1 : 0, now).run();

    const newStreak = await updateHabitStreak(c.env.DB, habitId, today);
    return c.json({ doneToday: true, streak: newStreak, isTwoMinToday: isTwoMin });
  }
});

// DELETE /api/habits/:id
// PUT /api/habits/:id — edit habit
habits.put('/:id', async (c) => {
  const user = c.get('user');
  const habitId = c.req.param('id');
  type HabitBody = { name?: string; color?: string; triggerCue?: string; twoMin?: string; goalIds?: string[]; reminderTime?: string };
  const body = await c.req.json<HabitBody>().catch((): HabitBody => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  // verify ownership
  const habit = await c.env.DB.prepare('SELECT id FROM habits WHERE id = ?1 AND user_id = ?2')
    .bind(habitId, user.sub).first();
  if (!habit) return c.json({ error: 'not found' }, 404);

  const goalIdsStr = JSON.stringify(body.goalIds ?? []);

  await c.env.DB.prepare(
    `UPDATE habits SET name = ?1, color = ?2, trigger_cue = ?3, two_min = ?4, goal_ids = ?5, action_time = ?6
     WHERE id = ?7 AND user_id = ?8`
  ).bind(
    (body.name || '').trim(),
    body.color ?? '#34C759',
    body.triggerCue?.trim() ?? null,
    body.twoMin?.trim() ?? null,
    goalIdsStr,
    body.reminderTime?.trim() ?? null,
    habitId,
    user.sub
  ).run();

  await syncGoalHabitRelations(c.env.DB, user.sub);

  return c.json({ ok: true });
});

// DELETE /api/habits/:id
habits.delete('/:id', async (c) => {
  const user = c.get('user');
  const habitId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM habits WHERE id = ?1 AND user_id = ?2').bind(habitId, user.sub).run();
  await syncGoalHabitRelations(c.env.DB, user.sub);
  return c.json({ ok: true });
});

// GET /api/habits/completions?weeks=52
// Returns { habitId, name, color, dates[], startDate, today }[] for all user habits
habits.get('/completions', async (c) => {
  const user = c.get('user');
  const weeks = Math.min(parseInt(c.req.query('weeks') ?? '52', 10), 104);

  const today = jakartaToday();
  const startDate = (() => {
    const parts = today.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() - weeks * 7);
    return d.toISOString().slice(0, 10);
  })();

  const [habitsRes, completionsRes] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, color FROM habits WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC')
      .bind(user.sub).all<{ id: string; name: string; color: string }>(),
    c.env.DB.prepare(
      'SELECT habit_id, completed_date FROM habit_completions WHERE user_id = ?1 AND completed_date >= ?2 ORDER BY completed_date ASC'
    ).bind(user.sub, startDate).all<{ habit_id: string; completed_date: string }>(),
  ]);

  const habitsList = habitsRes.results ?? [];
  const completions = completionsRes.results ?? [];

  const byHabit = new Map<string, string[]>();
  for (const cp of completions) {
    if (!byHabit.has(cp.habit_id)) byHabit.set(cp.habit_id, []);
    byHabit.get(cp.habit_id)!.push(cp.completed_date);
  }

  return c.json(habitsList.map(h => ({
    habitId: h.id,
    name: h.name,
    color: h.color,
    dates: byHabit.get(h.id) ?? [],
    startDate,
    today,
  })));
});

export default habits;
