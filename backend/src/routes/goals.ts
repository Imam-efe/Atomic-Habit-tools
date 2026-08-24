import { Hono } from 'hono';
import type { GoalRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, jakartaToday } from '../lib/validate';

const goals = new Hono<AuthContext>();

goals.use('/*', requireAuth);

async function syncHabitsForGoal(db: D1Database, userId: string, goalId: string, targetHabitIds: string[]) {
  const habitsRes = await db.prepare('SELECT id, goal_ids FROM habits WHERE user_id = ?1').bind(userId).all<{ id: string; goal_ids: string }>();
  const habits = habitsRes.results ?? [];
  const targetSet = new Set(targetHabitIds);

  const batch = [];
  for (const h of habits) {
    let arr: string[] = [];
    try {
      arr = JSON.parse(h.goal_ids ?? '[]');
    } catch {}

    const hasGoal = arr.includes(goalId);
    const shouldHaveGoal = targetSet.has(h.id);

    if (hasGoal && !shouldHaveGoal) {
      const updated = arr.filter(id => id !== goalId);
      batch.push(db.prepare('UPDATE habits SET goal_ids = ?1 WHERE id = ?2').bind(JSON.stringify(updated), h.id));
    } else if (!hasGoal && shouldHaveGoal) {
      const updated = [...arr, goalId];
      batch.push(db.prepare('UPDATE habits SET goal_ids = ?1 WHERE id = ?2').bind(JSON.stringify(updated), h.id));
    }
  }

  batch.push(db.prepare('UPDATE goals SET habit_ids = ?1 WHERE id = ?2').bind(JSON.stringify(targetHabitIds), goalId));

  if (batch.length > 0) {
    await db.batch(batch);
  }
}

async function cleanDeletedGoalInHabits(db: D1Database, userId: string, goalId: string) {
  const habitsRes = await db.prepare('SELECT id, goal_ids FROM habits WHERE user_id = ?1').bind(userId).all<{ id: string; goal_ids: string }>();
  const habits = habitsRes.results ?? [];
  const batch = [];
  for (const h of habits) {
    let arr: string[] = [];
    try {
      arr = JSON.parse(h.goal_ids ?? '[]');
    } catch {}

    if (arr.includes(goalId)) {
      const updated = arr.filter(id => id !== goalId);
      batch.push(db.prepare('UPDATE habits SET goal_ids = ?1 WHERE id = ?2').bind(JSON.stringify(updated), h.id));
    }
  }
  if (batch.length > 0) {
    await db.batch(batch);
  }
}

function calculateLevelAndExp(totalExp: number) {
  let level = 1;
  let expNeeded = 100;
  let remainingExp = totalExp;
  
  while (remainingExp >= expNeeded) {
    remainingExp -= expNeeded;
    level++;
    expNeeded = level * 100;
  }
  
  return {
    level,
    currentExp: remainingExp,
    nextLevelExp: expNeeded,
    totalExp
  };
}

// GET /api/goals
goals.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const [gRows, hRows, completionsRes, allCompletionsRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM goals WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC').bind(user.sub).all<GoalRow>(),
    c.env.DB.prepare('SELECT id FROM habits WHERE user_id = ?1').bind(user.sub).all<{ id: string }>(),
    c.env.DB.prepare('SELECT habit_id FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2').bind(user.sub, today).all<{ habit_id: string }>(),
    c.env.DB.prepare('SELECT habit_id, is_two_min FROM habit_completions WHERE user_id = ?1').bind(user.sub).all<{ habit_id: string; is_two_min: number }>()
  ]);

  const activeHabitIds = new Set((hRows.results ?? []).map(h => h.id));
  const doneHabitIds = new Set((completionsRes.results ?? []).map(r => r.habit_id));

  // Build a map of habit XP
  const habitXpMap = new Map<string, number>();
  for (const comp of (allCompletionsRes.results ?? [])) {
    const xp = comp.is_two_min === 1 ? 5 : 10;
    habitXpMap.set(comp.habit_id, (habitXpMap.get(comp.habit_id) ?? 0) + xp);
  }

  const result = (gRows.results ?? []).map(g => {
    let habitIds: string[] = [];
    try {
      habitIds = JSON.parse(g.habit_ids ?? '[]');
    } catch {}

    // Filter to only include habits that still exist
    const filteredHabitIds = habitIds.filter(id => activeHabitIds.has(id));

    // Calculate progress based on habit completions today
    const totalCount = filteredHabitIds.length;
    const completedCount = filteredHabitIds.filter(id => doneHabitIds.has(id)).length;
    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Calculate XP and level
    let goalXp = 0;
    for (const hId of filteredHabitIds) {
      goalXp += habitXpMap.get(hId) ?? 0;
    }

    const levelInfo = calculateLevelAndExp(goalXp);

    return {
      id: g.id,
      identityStatement: g.identity_statement,
      color: g.color,
      icon: g.icon,
      habitIds: filteredHabitIds,
      progress,
      level: levelInfo.level,
      currentExp: levelInfo.currentExp,
      nextLevelExp: levelInfo.nextLevelExp,
      totalExp: levelInfo.totalExp
    };
  });

  return c.json(result);
});

// POST /api/goals
goals.post('/', async (c) => {
  const user = c.get('user');
  type GoalBody = { identityStatement?: string; color?: string; habitIds?: string[] };
  const body = await c.req.json<GoalBody>().catch((): GoalBody => ({}));

  const err = validate(body as Record<string, unknown>, { identityStatement: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const targetHabitIds = body.habitIds ?? [];

  await c.env.DB.prepare(
    'INSERT INTO goals (id, user_id, identity_statement, color, habit_ids, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(id, user.sub, (body.identityStatement || '').trim(), body.color ?? '#7C5CFF', JSON.stringify(targetHabitIds), now).run();

  await syncHabitsForGoal(c.env.DB, user.sub, id, targetHabitIds);

  return c.json({
    id,
    identityStatement: (body.identityStatement || '').trim(),
    color: body.color ?? '#7C5CFF',
    habitIds: targetHabitIds,
    progress: 0
  }, 201);
});

// PUT /api/goals/:id
goals.put('/:id', async (c) => {
  const user = c.get('user');
  const goalId = c.req.param('id');
  type GoalBody = { identityStatement?: string; color?: string; habitIds?: string[] };
  const body = await c.req.json<GoalBody>().catch((): GoalBody => ({}));

  const err = validate(body as Record<string, unknown>, { identityStatement: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  // verify ownership
  const goal = await c.env.DB.prepare('SELECT id FROM goals WHERE id = ?1 AND user_id = ?2')
    .bind(goalId, user.sub).first();
  if (!goal) return c.json({ error: 'not found' }, 404);

  const targetHabitIds = body.habitIds ?? [];

  await c.env.DB.prepare(
    'UPDATE goals SET identity_statement = ?1, color = ?2, habit_ids = ?3 WHERE id = ?4 AND user_id = ?5'
  ).bind((body.identityStatement || '').trim(), body.color ?? '#7C5CFF', JSON.stringify(targetHabitIds), goalId, user.sub).run();

  await syncHabitsForGoal(c.env.DB, user.sub, goalId, targetHabitIds);

  return c.json({ ok: true });
});

// DELETE /api/goals/:id
goals.delete('/:id', async (c) => {
  const user = c.get('user');
  const goalId = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM goals WHERE id = ?1 AND user_id = ?2').bind(goalId, user.sub).run();
  await cleanDeletedGoalInHabits(c.env.DB, user.sub, goalId);

  return c.json({ ok: true });
});

// GET /api/goals/score
// Returns overall identity score (today) + 7-day history + per-goal scores
goals.get('/score', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  // Build list of last 7 days (oldest first)
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const parts = today.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const startDate = days[0];

  const goalsRes = await c.env.DB.prepare(
    'SELECT id, identity_statement, color, habit_ids FROM goals WHERE user_id = ?1'
  ).bind(user.sub).all<{ id: string; identity_statement: string; color: string; habit_ids: string }>();
  const allGoals = goalsRes.results ?? [];

  if (allGoals.length === 0) {
    return c.json({ today: 0, history: [], goals: [] });
  }

  const completionsRes = await c.env.DB.prepare(
    'SELECT habit_id, completed_date FROM habit_completions WHERE user_id = ?1 AND completed_date >= ?2'
  ).bind(user.sub, startDate).all<{ habit_id: string; completed_date: string }>();
  const completions = completionsRes.results ?? [];

  const byDay = new Map<string, Set<string>>();
  for (const cp of completions) {
    if (!byDay.has(cp.completed_date)) byDay.set(cp.completed_date, new Set());
    byDay.get(cp.completed_date)!.add(cp.habit_id);
  }

  const allHabitIds = new Set<string>();
  for (const g of allGoals) {
    try { (JSON.parse(g.habit_ids ?? '[]') as string[]).forEach(id => allHabitIds.add(id)); } catch {}
  }
  const totalHabits = allHabitIds.size;

  const history = days.map(day => {
    const done = byDay.get(day);
    if (!done || totalHabits === 0) return { date: day, score: 0 };
    const count = [...allHabitIds].filter(id => done.has(id)).length;
    return { date: day, score: Math.round((count / totalHabits) * 100) };
  });

  const todayScore = history[history.length - 1]?.score ?? 0;

  const goalsWithScore = allGoals.map(g => {
    let habitIds: string[] = [];
    try { habitIds = JSON.parse(g.habit_ids ?? '[]') as string[]; } catch {}
    const todayDone = byDay.get(today);
    const done = todayDone ? habitIds.filter(id => todayDone.has(id)).length : 0;
    const score = habitIds.length > 0 ? Math.round((done / habitIds.length) * 100) : 0;
    return {
      id: g.id,
      identityStatement: g.identity_statement,
      color: g.color,
      habitCount: habitIds.length,
      score,
    };
  });

  return c.json({ today: todayScore, history, goals: goalsWithScore });
});

export default goals;
