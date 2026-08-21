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
import { buildPushPayload } from '@block65/webcrypto-web-push';
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

  // Find habits with action_time matching the current hhmm
  const habitsToRemind = await env.DB.prepare(`
    SELECT h.id, h.name, h.user_id, h.action_time, s.endpoint, s.p256dh, s.auth
    FROM habits h
    JOIN push_subscriptions s ON h.user_id = s.user_id
    WHERE h.action_time = ?1
  `).bind(hhmm).all<{
    id: string;
    name: string;
    user_id: string;
    action_time: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>();

  if (!habitsToRemind.results || habitsToRemind.results.length === 0) {
    return;
  }

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  // Queue events for Shortcuts polling (dedupe per user+habit — subscriptions join can duplicate rows)
  const queued = new Set<string>();
  for (const row of habitsToRemind.results) {
    const key = `${row.user_id}:${row.id}`;
    if (queued.has(key)) continue;
    queued.add(key);
    await queueNotificationEvent(
      env,
      row.user_id,
      'habit_reminder',
      'Pengingat Kebiasaan',
      `Ayo lakukan kebiasaanmu: ${row.name}! ✨`,
      { habitId: row.id, habitName: row.name, url: '/kebiasaan' }
    );
  }

  const promises = habitsToRemind.results.map(async (row) => {
    const subscription = {
      endpoint: row.endpoint,
      expirationTime: null,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    };

    const message = {
      data: JSON.stringify({
        title: 'Pengingat Kebiasaan',
        body: `Ayo lakukan kebiasaanmu: ${row.name}! ✨`,
        url: '/kebiasaan',
      })
    };

    try {
      const payload = await buildPushPayload(message, subscription, vapid);
      if (payload.headers) {
        if (typeof (payload.headers as any).set === 'function') {
          (payload.headers as any).set('Urgency', 'high');
        } else {
          (payload.headers as any)['Urgency'] = 'high';
        }
      }
      const res = await fetch(row.endpoint, payload);
      if (res.status === 410 || res.status === 404) {
        // Clean up expired subscriptions
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(row.endpoint).run();
      }
    } catch (err) {
      console.error('Failed to send push notification', err);
    }
  });

  await Promise.all(promises);
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

  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  for (const [userId, userItems] of byUser.entries()) {
    const subs = await env.DB.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?1'
    ).bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();

    if (!subs.results || subs.results.length === 0) continue;

    const itemList = userItems.map(i => `• ${i.name} (${i.quantity} ${i.unit}) — kadaluarsa ${i.expiry_date}`).join('\n');
    const body = userItems.length === 1
      ? `${userItems[0].name} kadaluarsa ${userItems[0].expiry_date}. Segera gunakan! 🚨`
      : `${userItems.length} item akan kadaluarsa:\n${itemList}`;

    const message = {
      data: JSON.stringify({
        title: '⚠️ Stok Mau Kadaluarsa',
        body,
        url: '/lainnya',
      })
    };

    await queueNotificationEvent(env, userId, 'expiry_alert', '⚠️ Stok Mau Kadaluarsa', body, {
      items: userItems.map(i => ({ name: i.name, expiryDate: i.expiry_date })),
      url: '/lainnya',
    });

    for (const sub of subs.results) {
      try {
        const payload = await buildPushPayload(message, {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }, vapid);
        if (payload.headers) {
          if (typeof (payload.headers as any).set === 'function') {
            (payload.headers as any).set('Urgency', 'high');
          } else {
            (payload.headers as any)['Urgency'] = 'high';
          }
        }
        const res = await fetch(sub.endpoint, payload);
        if (res.status === 410 || res.status === 404) {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(sub.endpoint).run();
        }
      } catch (err) {
        console.error('Expiry alert push failed', err);
      }
    }

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
      processRecurringBudget(env),
      triggerExpiryAlerts(env),
      // Purge notification events older than 7 days
      env.DB.prepare(
        "DELETE FROM notification_events WHERE created_at < unixepoch() - 7 * 86400"
      ).run().catch((err) => console.error('Notification event cleanup failed', err)),
    ]));
  }
};

export default handler;
