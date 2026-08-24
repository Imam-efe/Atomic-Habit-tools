import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { jakartaToday } from '../lib/validate';

const dashboard = new Hono<AuthContext>();

dashboard.use('/*', requireAuth);

dashboard.get('/', async (c) => {
  const user = c.get('user');
  // Jakarta, bukan UTC: sebelum jam 7 pagi WIB, UTC masih tanggal kemarin,
  // jadi dashboard menampilkan data hari sebelumnya sepanjang pagi buta.
  const today = jakartaToday();
  const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const [habitsTotal, habitsDone, goalsTotal, budgetSummary, firstGoal, habitsList, yesterdayCompletions, todayCompletions] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as n FROM habits WHERE user_id = ?1').bind(user.sub).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2').bind(user.sub, today).first<{ n: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as n FROM goals WHERE user_id = ?1').bind(user.sub).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT SUM(CASE WHEN type='income' THEN amount_idr ELSE 0 END) as income,
              SUM(CASE WHEN type='expense' THEN amount_idr ELSE 0 END) as expense
       FROM budget_entries WHERE user_id = ?1 AND entry_date >= ?2`
    ).bind(user.sub, `${month}-01`).first<{ income: number | null; expense: number | null }>(),
    c.env.DB.prepare('SELECT identity_statement FROM goals WHERE user_id = ?1 ORDER BY sort_order ASC, created_at ASC LIMIT 1').bind(user.sub).first<{ identity_statement: string }>(),
    // Weekly-frequency habits are left out here: they're joined and filtered
    // below, since "missed yesterday" only means something for a daily habit.
    c.env.DB.prepare(`
      SELECT h.id, h.name, h.last_completed_date
      FROM habits h
      LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
      WHERE h.user_id = ?1 AND (hf.frequency_type IS NULL OR hf.frequency_type != 'weekly')
    `).bind(user.sub).all<{ id: string; name: string; last_completed_date: string | null }>(),
    c.env.DB.prepare('SELECT habit_id FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2').bind(user.sub, yesterday).all<{ habit_id: string }>(),
    c.env.DB.prepare('SELECT habit_id FROM habit_completions WHERE user_id = ?1 AND completed_date = ?2').bind(user.sub, today).all<{ habit_id: string }>()
  ]);

  const maxStreak = await c.env.DB.prepare(
    'SELECT MAX(streak) as s FROM habits WHERE user_id = ?1'
  ).bind(user.sub).first<{ s: number | null }>();

  // Determine if there is a missed habit yesterday that is not yet completed today
  const yesterdayDoneSet = new Set((yesterdayCompletions.results ?? []).map(r => r.habit_id));
  const todayDoneSet = new Set((todayCompletions.results ?? []).map(r => r.habit_id));

  let missedHabitName: string | null = null;
  for (const h of (habitsList.results ?? [])) {
    if (!yesterdayDoneSet.has(h.id) && !todayDoneSet.has(h.id) && h.last_completed_date !== null) {
      missedHabitName = h.name;
      break;
    }
  }

  const identityText = firstGoal
    ? `Saya adalah orang yang ${firstGoal.identity_statement}`
    : 'Saya adalah orang yang terus berkembang 1% setiap hari.';

  return c.json({
    habitsTotal: habitsTotal?.n ?? 0,
    habitsDone: habitsDone?.n ?? 0,
    goalsTotal: goalsTotal?.n ?? 0,
    streak: maxStreak?.s ?? 0,
    identityStatement: identityText,
    missedHabitAlert: missedHabitName ? `${missedHabitName} terlewat kemarin — selesaikan hari ini agar streak aman.` : null,
    budget: {
      income: budgetSummary?.income ?? 0,
      expense: budgetSummary?.expense ?? 0,
    },
  });
});

export default dashboard;
