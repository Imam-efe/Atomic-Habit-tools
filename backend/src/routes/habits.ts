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

/** How many days a single habit may freeze per calendar month. */
export const FREEZE_QUOTA_PER_MONTH = 2;

export async function updateHabitStreak(db: D1Database, habitId: string, today: string): Promise<number> {
  const [completions, freezes] = await Promise.all([
    db.prepare(
      'SELECT completed_date, is_two_min FROM habit_completions WHERE habit_id = ?1 ORDER BY completed_date DESC'
    ).bind(habitId).all<{ completed_date: string; is_two_min: number }>(),
    db.prepare(
      'SELECT freeze_date FROM habit_streak_freezes WHERE habit_id = ?1'
    ).bind(habitId).all<{ freeze_date: string }>(),
  ]);

  const completionsList = completions.results ?? [];
  const dateMap = new Map(completionsList.map(c => [c.completed_date, c.is_two_min === 1]));
  const freezeSet = new Set((freezes.results ?? []).map(f => f.freeze_date));

  let streak = 0;
  let lastCompletedDate: string | null = null;

  if (completionsList.length > 0) {
    lastCompletedDate = completionsList[0].completed_date;
  }

  // Both branches walk backwards day by day; the only difference is whether
  // today itself is part of the run. Every path either moves checkDate back or
  // breaks, and completions and freezes are both finite, so this terminates —
  // the iteration cap is belt-and-braces against a runaway CPU burn in the
  // Worker rather than a reachable case.
  const walk = (from: string): number => {
    let count = 0;
    let checkDate = from;
    for (let guard = 0; guard < 4000; guard++) {
      if (dateMap.has(checkDate)) {
        count++;
        checkDate = getAdjacentDate(checkDate, -1);
        continue;
      }

      // A freeze bridges this missed day. The streak survives, but the frozen
      // day is not a completion, so it adds nothing to the count.
      if (freezeSet.has(checkDate)) {
        checkDate = getAdjacentDate(checkDate, -1);
        continue;
      }

      const nextDateStr = getAdjacentDate(checkDate, 1);
      if (dateMap.get(nextDateStr) === true) {
        checkDate = getAdjacentDate(checkDate, -1);
        if (dateMap.has(checkDate)) continue;
        break;
      }
      break;
    }
    return count;
  };

  streak = dateMap.has(today) ? walk(today) : walk(getAdjacentDate(today, -1));

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

  const [completions, freezes] = await Promise.all([
    c.env.DB.prepare(
      'SELECT habit_id, is_two_min FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2'
    ).bind(user.sub, today).all<{ habit_id: string; is_two_min: number }>(),
    c.env.DB.prepare(
      `SELECT habit_id, freeze_date FROM habit_streak_freezes
       WHERE user_id = ?1 AND freeze_date LIKE ?2 ORDER BY freeze_date DESC`
    ).bind(user.sub, `${today.slice(0, 7)}%`).all<{ habit_id: string; freeze_date: string }>(),
  ]);

  const completionsMap = new Map(completions.results.map(r => [r.habit_id, r.is_two_min === 1]));

  const freezesByHabit = new Map<string, string[]>();
  for (const f of freezes.results ?? []) {
    if (!freezesByHabit.has(f.habit_id)) freezesByHabit.set(f.habit_id, []);
    freezesByHabit.get(f.habit_id)!.push(f.freeze_date);
  }

  const result = (rows.results ?? []).map(h => {
    const used = freezesByHabit.get(h.id) ?? [];
    return {
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
      freezesUsed: used.length,
      freezesLeft: Math.max(0, FREEZE_QUOTA_PER_MONTH - used.length),
      lastFreezeDate: used[0] ?? null,
    };
  });

  return c.json(result);
});

/**
 * Grant a freeze to every habit that quietly lost its streak yesterday.
 *
 * Runs from the cron just after Jakarta midnight, once the day is genuinely
 * over. Automatic rather than a button, because a user who forgets the habit
 * also forgets to spend the freeze — and by the time they open the app the
 * streak is already gone.
 *
 * The unique index on (habit_id, freeze_date) makes a repeat tick a no-op, so
 * a slow run overlapping the next minute cannot hand out two freezes.
 */
export async function grantStreakFreezes(db: D1Database, today: string): Promise<number> {
  const yesterday = getAdjacentDate(today, -1);
  const monthPrefix = `${yesterday.slice(0, 7)}%`;

  const candidates = await db.prepare(`
    SELECT h.id, h.user_id,
           (SELECT COUNT(*) FROM habit_streak_freezes f
             WHERE f.habit_id = h.id AND f.freeze_date LIKE ?2) AS used
    FROM habits h
    WHERE h.streak > 0
      AND NOT EXISTS (
        SELECT 1 FROM habit_completions hc
        WHERE hc.habit_id = h.id AND hc.completed_date = ?1
      )
      AND NOT EXISTS (
        SELECT 1 FROM habit_streak_freezes f
        WHERE f.habit_id = h.id AND f.freeze_date = ?1
      )
  `).bind(yesterday, monthPrefix).all<{ id: string; user_id: string; used: number }>();

  let granted = 0;
  for (const habit of candidates.results ?? []) {
    if (habit.used >= FREEZE_QUOTA_PER_MONTH) continue;

    try {
      await db.prepare(
        'INSERT INTO habit_streak_freezes (id, habit_id, user_id, freeze_date) VALUES (?1, ?2, ?3, ?4)'
      ).bind(nanoid(), habit.id, habit.user_id, yesterday).run();
    } catch {
      // Lost the race with an overlapping tick — the unique index held.
      continue;
    }

    // Recompute so habits.streak reflects the bridge straight away, rather
    // than waiting for the user to next toggle the habit.
    await updateHabitStreak(db, habit.id, today);
    granted++;
  }

  return granted;
}

// GET /api/habits/freezes — this month's quota and what it was spent on
habits.get('/freezes', async (c) => {
  const user = c.get('user');
  const month = jakartaToday().slice(0, 7);

  const rows = await c.env.DB.prepare(`
    SELECT f.habit_id, f.freeze_date, h.name, h.color
    FROM habit_streak_freezes f
    JOIN habits h ON h.id = f.habit_id
    WHERE f.user_id = ?1 AND f.freeze_date LIKE ?2
    ORDER BY f.freeze_date DESC
  `).bind(user.sub, `${month}%`).all<{
    habit_id: string; freeze_date: string; name: string; color: string;
  }>();

  const usedByHabit = new Map<string, number>();
  for (const r of rows.results ?? []) {
    usedByHabit.set(r.habit_id, (usedByHabit.get(r.habit_id) ?? 0) + 1);
  }

  return c.json({
    month,
    quotaPerHabit: FREEZE_QUOTA_PER_MONTH,
    freezes: (rows.results ?? []).map(r => ({
      habitId: r.habit_id,
      habitName: r.name,
      color: r.color,
      date: r.freeze_date,
    })),
    usedByHabit: Object.fromEntries(usedByHabit),
  });
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
