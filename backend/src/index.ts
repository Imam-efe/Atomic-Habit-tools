import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import health from './routes/health';
import auth from './routes/auth';
import habits from './routes/habits';
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
import weeklyReview from './routes/weekly_review';
import exportRoute from './routes/export';
import habitBundles from './routes/habit_bundles';
import habitStacks from './routes/habit_stacks';
import scheduledNotifications, {
  deliverScheduledNotification,
  type ScheduledNotificationRow,
} from './routes/scheduled_notifications';
import { sendPushToUser, queueNotificationEvent } from './lib/push';
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

app.notFound((c) => c.json({ error: 'not found' }, 404));

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
