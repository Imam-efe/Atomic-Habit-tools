import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import health from './routes/health';
import auth from './routes/auth';
import habits, { grantStreakFreezes } from './routes/habits';
import goals from './routes/goals';
import budget from './routes/budget';
import dashboard from './routes/dashboard';
import projects from './routes/projects';
import activity from './routes/activity';
import nutrition from './routes/nutrition';
import notifications from './routes/notifications';
import menstrual from './routes/menstrual';
import shortcut from './routes/shortcut';
import bankAccounts from './routes/bank_accounts';
import inventory from './routes/inventory';
import kidsSchedule from './routes/kids_schedule';
import debts from './routes/debts';
import financeReport from './routes/finance_report';
import netWorth from './routes/net_worth';
import weeklyReview, { getMondayOf } from './routes/weekly_review';
import achievements from './routes/achievements';
import insights from './routes/insights';
import quickadd from './routes/quickadd';
import search from './routes/search';
import exportRoute from './routes/export';
import habitBundles from './routes/habit_bundles';
import habitStacks from './routes/habit_stacks';
import scheduledNotifications, {
  deliverScheduledNotification,
  type ScheduledNotificationRow,
} from './routes/scheduled_notifications';
// queueNotificationEvent is declared locally below; importing it too shadowed
// the local one and made the whole backend fail `tsc`.
import { sendPushToUser } from './lib/push';
import calendar from './routes/calendar';
import holidays from './routes/holidays';
import { syncHolidays } from './lib/holiday_source';
import { computeNextRun } from './lib/schedule';
import { advanceDate, jakartaToday } from './lib/validate';
import { nanoid } from './lib/nanoid';

const app = new Hono<{ Bindings: Env }>();

// Prevent any intermediate caching of API responses
app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.res.headers.set('Pragma', 'no-cache');
});

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const allowed = [
        c.env.FRONTEND_URL,
        'https://fayolla.pages.dev',
        'http://localhost:5173',
      ];
      return allowed.includes(origin) ? origin : allowed[0];
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.route('/api/health', health);
app.route('/api/auth', auth);
app.route('/api/habits', habits);
app.route('/api/goals', goals);
app.route('/api/budget', budget);
app.route('/api/dashboard', dashboard);
app.route('/api/projects', projects);
app.route('/api/activity', activity);
app.route('/api/nutrition', nutrition);
app.route('/api/notifications', notifications);
app.route('/api/menstrual', menstrual);
app.route('/api/shortcut', shortcut);
app.route('/api/bank-accounts', bankAccounts);
app.route('/api/inventory', inventory);
app.route('/api/kids-schedule', kidsSchedule);
app.route('/api/debts', debts);
app.route('/api/finance-report', financeReport);
app.route('/api/net-worth', netWorth);
app.route('/api/weekly-review', weeklyReview);
app.route('/api/export', exportRoute);
app.route('/api/habit-bundles', habitBundles);
app.route('/api/habit-stacks', habitStacks);
app.route('/api/scheduled-notifications', scheduledNotifications);
app.route('/api/calendar', calendar);
app.route('/api/holidays', holidays);
app.route('/api/achievements', achievements);
app.route('/api/insights', insights);
app.route('/api/quickadd', quickadd);
app.route('/api/search', search);

app.notFound((c) => c.json({ error: 'not found' }, 404));

// Queue a notification event so external consumers (iOS Shortcuts) can poll it
async function queueNotificationEvent(
  env: Env,
  userId: string,
  type: string,
  title: string,
  body: string,
  payload?: Record<string, unknown>
) {
  try {
    await env.DB.prepare(`
      INSERT INTO notification_events (id, user_id, type, title, body, payload)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(nanoid(), userId, type, title, body, payload ? JSON.stringify(payload) : null).run();
  } catch (err) {
    console.error('Failed to queue notification event', err);
  }
}

// Trigger push notifications for habit reminders matching the current time (Jakarta GMT+7)
async function triggerReminders(env: Env) {
  const now = new Date();
  const jakartaTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const hours = String(jakartaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(jakartaTime.getUTCMinutes()).padStart(2, '0');
  const hhmm = `${hours}:${minutes}`;

  // Find habits with action_time matching the current hhmm, for users who can receive push
  const habitsToRemind = await env.DB.prepare(`
    SELECT DISTINCT h.id, h.name, h.user_id
    FROM habits h
    JOIN push_subscriptions s ON h.user_id = s.user_id
    WHERE h.action_time = ?1
  `).bind(hhmm).all<{ id: string; name: string; user_id: string }>();

  const rows = habitsToRemind.results ?? [];
  if (rows.length === 0) return;

  for (const row of rows) {
    const title = 'Pengingat Kebiasaan';
    const body = `Ayo lakukan kebiasaanmu: ${row.name}! ✨`;

    await queueNotificationEvent(env, row.user_id, 'habit_reminder', title, body, {
      habitId: row.id,
      habitName: row.name,
      url: '/kebiasaan',
    });

    await sendPushToUser(env, row.user_id, { title, body, url: '/kebiasaan' });
  }
}

// Send every custom reminder whose next_run_at has come due (Notification Center)
async function processScheduledNotifications(env: Env) {
  const now = Math.floor(Date.now() / 1000);

  const due = await env.DB.prepare(`
    SELECT * FROM scheduled_notifications
    WHERE is_active = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?1
    ORDER BY next_run_at ASC
    LIMIT 50
  `).bind(now).all<ScheduledNotificationRow>();

  for (const row of due.results ?? []) {
    // A slow previous run can overlap the next cron tick — don't fire twice in one minute
    if (row.last_fired_at !== null && now - row.last_fired_at < 30) continue;

    const firedCount = row.fired_count + 1;
    const reachedMax = row.max_occurrences !== null && firedCount >= row.max_occurrences;
    const nextRunAt = row.schedule_type === 'once' || reachedMax
      ? null
      : computeNextRun(row, now);

    // Advance the schedule before delivering, so a failed send can never double-fire
    await env.DB.prepare(`
      UPDATE scheduled_notifications
      SET next_run_at = ?1, last_fired_at = ?2, fired_count = ?3, is_active = ?4
      WHERE id = ?5
    `).bind(nextRunAt, now, firedCount, nextRunAt === null ? 0 : 1, row.id).run();

    await deliverScheduledNotification(env, row);
  }
}

async function processRecurringBudget(env: Env) {
  const today = jakartaToday();

  const due = await env.DB.prepare(`
    SELECT * FROM budget_entries
    WHERE recurrence IS NOT NULL AND next_recurrence_date <= ?1
  `).bind(today).all<{
    id: string;
    user_id: string;
    type: string;
    amount_idr: number;
    category: string;
    note: string | null;
    bank_account_id: string | null;
    recurrence: string;
    next_recurrence_date: string;
  }>();

  if (!due.results || due.results.length === 0) return;

  const now = Math.floor(Date.now() / 1000);

  for (const template of due.results) {
    const newId = nanoid();
    const entryDate = template.next_recurrence_date;
    const nextDate = advanceDate(entryDate, template.recurrence as 'daily' | 'weekly' | 'monthly');

    // Create new entry (recurrence = NULL — it's a generated copy)
    await env.DB.prepare(`
      INSERT INTO budget_entries
        (id, user_id, type, amount_idr, category, note, entry_date, bank_account_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `).bind(newId, template.user_id, template.type, template.amount_idr, template.category,
            template.note, entryDate, template.bank_account_id, now).run();

    // Adjust bank account balance if linked
    if (template.bank_account_id) {
      const sign = template.type === 'expense' ? -1 : 1;
      await env.DB.prepare(`
        UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3
      `).bind(sign * template.amount_idr, template.bank_account_id, template.user_id).run();
    }

    // Advance the template's next_recurrence_date
    await env.DB.prepare(`
      UPDATE budget_entries SET next_recurrence_date = ?1 WHERE id = ?2
    `).bind(nextDate, template.id).run();
  }
}

async function triggerExpiryAlerts(env: Env) {
  // Only run at 8 AM Jakarta time (UTC+7)
  const now = new Date();
  const jakartaHour = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  if (jakartaHour !== 8) return;

  const today = jakartaToday();

  const threeDaysFromNow = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  })();

  const items = await env.DB.prepare(`
    SELECT i.id, i.user_id, i.name, i.expiry_date, i.quantity, i.unit
    FROM inventory_items i
    WHERE i.expiry_date BETWEEN ?1 AND ?2
      AND (i.expiry_alert_sent IS NULL OR i.expiry_alert_sent != ?3)
  `).bind(today, threeDaysFromNow, today).all<{
    id: string;
    user_id: string;
    name: string;
    expiry_date: string;
    quantity: number;
    unit: string;
  }>();

  if (!items.results || items.results.length === 0) return;

  // Group items by user
  const byUser = new Map<string, typeof items.results>();
  for (const item of items.results) {
    if (!byUser.has(item.user_id)) byUser.set(item.user_id, []);
    byUser.get(item.user_id)!.push(item);
  }

  for (const [userId, userItems] of byUser.entries()) {
    const itemList = userItems.map(i => `• ${i.name} (${i.quantity} ${i.unit}) — kadaluarsa ${i.expiry_date}`).join('\n');
    const title = '⚠️ Stok Mau Kadaluarsa';
    const body = userItems.length === 1
      ? `${userItems[0].name} kadaluarsa ${userItems[0].expiry_date}. Segera gunakan! 🚨`
      : `${userItems.length} item akan kadaluarsa:\n${itemList}`;

    await queueNotificationEvent(env, userId, 'expiry_alert', title, body, {
      items: userItems.map(i => ({ name: i.name, expiryDate: i.expiry_date })),
      url: '/lainnya',
    });

    const pushResult = await sendPushToUser(env, userId, { title, body, url: '/lainnya' });
    if (pushResult.subscriptions === 0) continue;

    // Mark all notified items as sent today
    const placeholders = userItems.map((_, i) => `?${i + 2}`).join(',');
    const bindings: unknown[] = [today, ...userItems.map(i => i.id)];
    await env.DB.prepare(
      `UPDATE inventory_items SET expiry_alert_sent = ?1 WHERE id IN (${placeholders})`
    ).bind(...bindings).run();
  }
}

// Evening nudge for habits with an active streak not yet done today — the
// same day-scoped dedup flag as expiry alerts (streak_alert_sent = today)
// absorbs the once-a-minute cron tick so each habit fires once per day.
async function triggerStreakAtRisk(env: Env) {
  // Only run at 20:00 Jakarta time — late enough to be a real "about to lose it"
  // nudge, early enough that there's still time to act before midnight.
  const now = new Date();
  const jakartaHour = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  if (jakartaHour !== 20) return;

  const today = jakartaToday();

  const atRisk = await env.DB.prepare(`
    SELECT h.id, h.name, h.user_id, h.streak
    FROM habits h
    JOIN push_subscriptions s ON h.user_id = s.user_id
    WHERE h.streak > 0
      AND (h.last_completed_date IS NULL OR h.last_completed_date != ?1)
      AND (h.streak_alert_sent IS NULL OR h.streak_alert_sent != ?1)
  `).bind(today).all<{ id: string; name: string; user_id: string; streak: number }>();

  const rows = atRisk.results ?? [];
  if (rows.length === 0) return;

  const byUser = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row);
  }

  for (const [userId, habits] of byUser.entries()) {
    const title = habits.length === 1 ? '🔥 Streak Terancam!' : `🔥 ${habits.length} Streak Terancam!`;
    const body = habits.length === 1
      ? `${habits[0].name}: streak ${habits[0].streak} hari akan putus kalau belum selesai hari ini!`
      : `${habits.map(h => `${h.name} (${h.streak} hari)`).join(', ')} — selesaikan sebelum tengah malam!`;

    await queueNotificationEvent(env, userId, 'streak_at_risk', title, body, {
      habits: habits.map(h => ({ id: h.id, name: h.name, streak: h.streak })),
      url: '/kebiasaan',
    });

    const pushResult = await sendPushToUser(env, userId, { title, body, url: '/kebiasaan' });
    if (pushResult.subscriptions === 0) continue;

    const placeholders = habits.map((_, i) => `?${i + 2}`).join(',');
    await env.DB.prepare(
      `UPDATE habits SET streak_alert_sent = ?1 WHERE id IN (${placeholders})`
    ).bind(today, ...habits.map(h => h.id)).run();
  }
}

// Sunday-evening summary push: habit consistency for the week just ending.
// Dedup via users.last_weekly_recap_sent (the Monday date of the recapped
// week) — same idea as streak_alert_sent, but user-scoped since this is one
// aggregate push per user rather than one per row.
async function triggerWeeklyRecap(env: Env) {
  const now = new Date();
  const jakartaHour = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
  const jakartaDay = new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCDay(); // 0 = Sunday
  if (jakartaHour !== 20 || jakartaDay !== 0) return;

  const today = jakartaToday();
  const weekStart = getMondayOf(today);

  const users = await env.DB.prepare(`
    SELECT DISTINCT u.id
    FROM users u
    JOIN push_subscriptions s ON u.id = s.user_id
    WHERE u.last_weekly_recap_sent IS NULL OR u.last_weekly_recap_sent != ?1
  `).bind(weekStart).all<{ id: string }>();

  for (const { id: userId } of users.results ?? []) {
    const habitStats = await env.DB.prepare(`
      SELECT h.id, h.streak, COUNT(hc.id) as completions_this_week
      FROM habits h
      LEFT JOIN habit_completions hc
        ON hc.habit_id = h.id AND hc.completed_date BETWEEN ?2 AND ?3 AND hc.user_id = h.user_id
      WHERE h.user_id = ?1
      GROUP BY h.id
    `).bind(userId, weekStart, today).all<{ id: string; streak: number; completions_this_week: number }>();

    const habits = habitStats.results ?? [];
    // Nothing tracked yet — a recap of zero habits isn't worth a push, and
    // marking it sent would stop it from ever nudging the user once they add one.
    if (habits.length === 0) continue;

    const totalCompletions = habits.reduce((s, h) => s + h.completions_this_week, 0);
    const possibleCompletions = habits.length * 7;
    const consistency = Math.round((totalCompletions / possibleCompletions) * 100);
    const longestStreak = Math.max(...habits.map(h => h.streak));

    const title = '📊 Rekap Mingguanmu';
    const body = `Konsistensi ${consistency}% minggu ini · Streak terpanjang ${longestStreak} hari. Lihat detailnya di Review Mingguan!`;

    await queueNotificationEvent(env, userId, 'weekly_recap', title, body, {
      weekStart,
      consistency,
      longestStreak,
      url: '/lainnya',
    });

    await sendPushToUser(env, userId, { title, body, url: '/lainnya' });

    await env.DB.prepare(
      'UPDATE users SET last_weekly_recap_sent = ?1 WHERE id = ?2'
    ).bind(weekStart, userId).run();
  }
}

// Hand out streak freezes for yesterday, just after Jakarta midnight. The day
// has to be genuinely over before a miss counts as a miss — running this at
// 23:00 would burn a freeze on a habit the user was still about to do.
async function processStreakFreezes(env: Env) {
  const jakarta = new Date(Date.now() + 7 * 60 * 60 * 1000);
  if (jakarta.getUTCHours() !== 0 || jakarta.getUTCMinutes() !== 5) return;

  await grantStreakFreezes(env.DB, jakartaToday());
}

const handler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: any, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      triggerReminders(env),
      processScheduledNotifications(env),
      processRecurringBudget(env),
      triggerExpiryAlerts(env),
      triggerStreakAtRisk(env),
      triggerWeeklyRecap(env),
      processStreakFreezes(env).catch((err) => console.error('Streak freeze grant failed', err)),
      // Holiday feed. Sunday only — the decree changes once a year, so a daily
      // pull would be noise. A failure leaves the previous cache in place.
      (new Date().getUTCDay() === 0
        ? syncHolidays(env).catch((err) => console.error('Holiday sync failed', err))
        : Promise.resolve()),
      // Purge notification events older than 7 days
      env.DB.prepare(
        "DELETE FROM notification_events WHERE created_at < unixepoch() - 7 * 86400"
      ).run().catch((err) => console.error('Notification event cleanup failed', err)),
      // Keep 30 days of delivery history
      env.DB.prepare(
        "DELETE FROM notification_deliveries WHERE fired_at < unixepoch() - 30 * 86400"
      ).run().catch((err) => console.error('Delivery history cleanup failed', err)),
    ]));
  }
};

export default handler;
