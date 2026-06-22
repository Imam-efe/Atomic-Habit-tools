import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';

const weeklyReview = new Hono<AuthContext>();
weeklyReview.use('/*', requireAuth);

// Helper: get Monday of the week containing a given YYYY-MM-DD
function getMondayOf(dateStr: string): string {
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// GET /api/weekly-review?week=YYYY-MM-DD  (defaults to current week)
weeklyReview.get('/', async (c) => {
  const user = c.get('user');
  const weekParam = c.req.query('week');
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = getMondayOf(weekParam || today);
  const weekEnd = (() => {
    const parts = weekStart.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  const review = await c.env.DB.prepare(
    'SELECT * FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{
    id: string; week_start: string; habit_reflection: string | null;
    obstacle: string | null; adjustment: string | null;
    identity_affirmation: string | null; rating: number;
  }>();

  const habitStats = await c.env.DB.prepare(`
    SELECT h.id, h.name, h.color, h.streak,
           COUNT(hc.id) as completions_this_week
    FROM habits h
    LEFT JOIN habit_completions hc
      ON hc.habit_id = h.id
      AND hc.completed_date BETWEEN ?2 AND ?3
      AND hc.user_id = h.user_id
    WHERE h.user_id = ?1
    GROUP BY h.id
  `).bind(user.sub, weekStart, weekEnd).all<{
    id: string; name: string; color: string; streak: number; completions_this_week: number;
  }>();

  const todayDate = new Date(today);
  const weekEndDate = new Date(weekEnd);
  const cappedEnd = todayDate < weekEndDate ? today : weekEnd;
  const startDate = new Date(weekStart);
  const daysElapsed = Math.max(1, Math.round((new Date(cappedEnd).getTime() - startDate.getTime()) / 86400000) + 1);

  const habits = (habitStats.results ?? []).map(h => ({
    ...h,
    consistency: Math.round((h.completions_this_week / Math.min(daysElapsed, 7)) * 100),
  }));

  const overallConsistency = habits.length > 0
    ? Math.round(habits.reduce((s, h) => s + h.consistency, 0) / habits.length)
    : 0;

  return c.json({
    weekStart,
    weekEnd,
    daysElapsed,
    overallConsistency,
    habits,
    review: review ?? null,
  });
});

// GET /api/weekly-review/list — last 10 reviews
weeklyReview.get('/list', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, week_start, rating, habit_reflection FROM weekly_reviews WHERE user_id = ?1 ORDER BY week_start DESC LIMIT 10'
  ).bind(user.sub).all<{ id: string; week_start: string; rating: number; habit_reflection: string | null }>();
  return c.json(rows.results ?? []);
});

// POST /api/weekly-review — upsert review for a week
weeklyReview.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    weekStart?: string;
    habitReflection?: string;
    obstacle?: string;
    adjustment?: string;
    identityAffirmation?: string;
    rating?: number;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = getMondayOf(body.weekStart || today);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM weekly_reviews WHERE user_id = ?1 AND week_start = ?2'
  ).bind(user.sub, weekStart).first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE weekly_reviews
      SET habit_reflection = ?1, obstacle = ?2, adjustment = ?3,
          identity_affirmation = ?4, rating = ?5
      WHERE id = ?6
    `).bind(
      body.habitReflection ?? null,
      body.obstacle ?? null,
      body.adjustment ?? null,
      body.identityAffirmation ?? null,
      body.rating ?? 3,
      existing.id
    ).run();
    return c.json({ id: existing.id, weekStart });
  }

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO weekly_reviews (id, user_id, week_start, habit_reflection, obstacle, adjustment, identity_affirmation, rating)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.sub, weekStart,
    body.habitReflection ?? null,
    body.obstacle ?? null,
    body.adjustment ?? null,
    body.identityAffirmation ?? null,
    body.rating ?? 3
  ).run();

  return c.json({ id, weekStart }, 201);
});

export default weeklyReview;
