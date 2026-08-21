import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { sendPushToUser, queueNotificationEvent } from '../lib/push';
import {
  computeNextRun,
  describeSchedule,
  parseHHMM,
  parseDaysOfWeek,
  type ScheduleType,
} from '../lib/schedule';
import type { Env } from '../types';

const app = new Hono<AuthContext>();

app.use('/*', requireAuth);

export interface ScheduledNotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
  url: string | null;
  schedule_type: ScheduleType;
  time_of_day: string | null;
  days_of_week: string | null;
  interval_minutes: number | null;
  run_at: number | null;
  quiet_from: string | null;
  quiet_to: string | null;
  max_occurrences: number | null;
  fired_count: number;
  next_run_at: number | null;
  last_fired_at: number | null;
  is_active: number;
  created_at: number;
}

const SCHEDULE_TYPES: ScheduleType[] = ['once', 'interval', 'daily', 'weekly'];

/** Shortest interval we accept. Below this APNs starts dropping messages. */
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 60 * 24 * 30;

interface NotificationBody {
  title?: string;
  body?: string;
  url?: string | null;
  schedule_type?: string;
  time_of_day?: string | null;
  days_of_week?: string | null;
  interval_minutes?: number | null;
  run_at?: number | null;
  quiet_from?: string | null;
  quiet_to?: string | null;
  max_occurrences?: number | null;
  is_active?: number;
}

/**
 * Validate a full notification definition.
 * Returns an error string, or the normalized row fields on success.
 */
function normalize(payload: NotificationBody): { error: string } | {
  values: Omit<ScheduledNotificationRow, 'id' | 'user_id' | 'fired_count' | 'next_run_at' | 'last_fired_at' | 'created_at'>;
} {
  const title = (payload.title ?? '').trim();
  const body = (payload.body ?? '').trim();

  if (!title) return { error: 'title wajib diisi' };
  if (!body) return { error: 'body wajib diisi' };
  if (title.length > 120) return { error: 'title maksimal 120 karakter' };
  if (body.length > 500) return { error: 'body maksimal 500 karakter' };

  const scheduleType = payload.schedule_type as ScheduleType;
  if (!SCHEDULE_TYPES.includes(scheduleType)) {
    return { error: `schedule_type harus salah satu dari: ${SCHEDULE_TYPES.join(', ')}` };
  }

  let timeOfDay: string | null = null;
  let daysOfWeek: string | null = null;
  let intervalMinutes: number | null = null;
  let runAt: number | null = null;

  if (scheduleType === 'daily' || scheduleType === 'weekly') {
    if (parseHHMM(payload.time_of_day) === null) {
      return { error: 'time_of_day harus format HH:MM' };
    }
    timeOfDay = payload.time_of_day as string;
  }

  if (scheduleType === 'weekly') {
    const days = parseDaysOfWeek(payload.days_of_week);
    if (days === null) {
      return { error: 'days_of_week harus berisi minimal satu hari (1=Sen .. 7=Min)' };
    }
    daysOfWeek = days.join(',');
  }

  if (scheduleType === 'interval') {
    const minutes = payload.interval_minutes;
    if (!Number.isInteger(minutes) || (minutes as number) < MIN_INTERVAL_MINUTES) {
      return { error: `interval_minutes minimal ${MIN_INTERVAL_MINUTES} menit` };
    }
    if ((minutes as number) > MAX_INTERVAL_MINUTES) {
      return { error: `interval_minutes maksimal ${MAX_INTERVAL_MINUTES} menit` };
    }
    intervalMinutes = minutes as number;
  }

  if (scheduleType === 'once') {
    const at = payload.run_at;
    if (!Number.isInteger(at) || (at as number) <= Math.floor(Date.now() / 1000)) {
      return { error: 'run_at harus timestamp unix di masa depan' };
    }
    runAt = at as number;
  }

  // Quiet hours are optional, but must come as a valid pair when present
  const quietFromRaw = payload.quiet_from || null;
  const quietToRaw = payload.quiet_to || null;
  if ((quietFromRaw === null) !== (quietToRaw === null)) {
    return { error: 'quiet_from dan quiet_to harus diisi berpasangan' };
  }
  if (quietFromRaw !== null && (parseHHMM(quietFromRaw) === null || parseHHMM(quietToRaw) === null)) {
    return { error: 'quiet_from dan quiet_to harus format HH:MM' };
  }

  const maxOccurrences = payload.max_occurrences ?? null;
  if (maxOccurrences !== null && (!Number.isInteger(maxOccurrences) || maxOccurrences < 1)) {
    return { error: 'max_occurrences harus bilangan bulat >= 1' };
  }

  const url = (payload.url ?? '').trim();
  if (url && !url.startsWith('/')) {
    return { error: 'url harus path internal yang diawali "/"' };
  }

  return {
    values: {
      title,
      body,
      url: url || null,
      schedule_type: scheduleType,
      time_of_day: timeOfDay,
      days_of_week: daysOfWeek,
      interval_minutes: intervalMinutes,
      run_at: runAt,
      quiet_from: quietFromRaw,
      quiet_to: quietToRaw,
      max_occurrences: maxOccurrences,
      is_active: payload.is_active === 0 ? 0 : 1,
    },
  };
}

function serialize(row: ScheduledNotificationRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    url: row.url,
    scheduleType: row.schedule_type,
    timeOfDay: row.time_of_day,
    daysOfWeek: row.days_of_week,
    intervalMinutes: row.interval_minutes,
    runAt: row.run_at,
    quietFrom: row.quiet_from,
    quietTo: row.quiet_to,
    maxOccurrences: row.max_occurrences,
    firedCount: row.fired_count,
    nextRunAt: row.next_run_at,
    lastFiredAt: row.last_fired_at,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    summary: describeSchedule(row),
  };
}

/**
 * Deliver one reminder: queue it for the iOS Shortcut, push it to the device,
 * and record the outcome. Shared by the cron runner and the "kirim sekarang" route.
 */
export async function deliverScheduledNotification(
  env: Env,
  row: Pick<ScheduledNotificationRow, 'id' | 'user_id' | 'title' | 'body' | 'url'>
): Promise<{ status: string; sent: number; failed: number; subscriptions: number }> {
  await queueNotificationEvent(env, row.user_id, 'custom_reminder', row.title, row.body, {
    notificationId: row.id,
    url: row.url ?? '/',
  });

  const result = await sendPushToUser(env, row.user_id, {
    title: row.title,
    body: row.body,
    url: row.url ?? '/',
  });

  const status = result.subscriptions === 0
    ? 'no_subscription'
    : result.sent > 0 ? 'sent' : 'failed';

  const detail = `${result.sent}/${result.subscriptions} terkirim`;

  try {
    await env.DB.prepare(`
      INSERT INTO notification_deliveries (id, notification_id, user_id, title, body, status, detail)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `).bind(nanoid(), row.id, row.user_id, row.title, row.body, status, detail).run();
  } catch (err) {
    console.error('Failed to log notification delivery', err);
  }

  return { status, ...result };
}

// GET /api/scheduled-notifications — list all reminders
app.get('/', async (c) => {
  const userId = c.get('user').sub;

  const rows = await c.env.DB.prepare(`
    SELECT * FROM scheduled_notifications
    WHERE user_id = ?1
    ORDER BY is_active DESC, next_run_at ASC, created_at DESC
  `).bind(userId).all<ScheduledNotificationRow>();

  return c.json((rows.results ?? []).map(serialize));
});

// GET /api/scheduled-notifications/deliveries — recent delivery history
app.get('/deliveries', async (c) => {
  const userId = c.get('user').sub;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10) || 30, 100);

  const rows = await c.env.DB.prepare(`
    SELECT id, notification_id, title, body, status, detail, fired_at
    FROM notification_deliveries
    WHERE user_id = ?1
    ORDER BY fired_at DESC
    LIMIT ?2
  `).bind(userId, limit).all<{
    id: string;
    notification_id: string | null;
    title: string;
    body: string;
    status: string;
    detail: string | null;
    fired_at: number;
  }>();

  return c.json((rows.results ?? []).map((row) => ({
    id: row.id,
    notificationId: row.notification_id,
    title: row.title,
    body: row.body,
    status: row.status,
    detail: row.detail,
    firedAt: row.fired_at,
  })));
});

// POST /api/scheduled-notifications — create a reminder
app.post('/', async (c) => {
  const userId = c.get('user').sub;
  const payload = await c.req.json<NotificationBody>().catch((): NotificationBody => ({}));

  const normalized = normalize(payload);
  if ('error' in normalized) return c.json({ error: normalized.error }, 400);
  const { values } = normalized;

  const now = Math.floor(Date.now() / 1000);
  const nextRunAt = values.is_active === 1 ? computeNextRun(values, now) : null;

  if (values.is_active === 1 && nextRunAt === null) {
    return c.json({ error: 'jadwal tidak menghasilkan waktu kirim berikutnya' }, 400);
  }

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO scheduled_notifications (
      id, user_id, title, body, url,
      schedule_type, time_of_day, days_of_week, interval_minutes, run_at,
      quiet_from, quiet_to, max_occurrences, next_run_at, is_active, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
  `).bind(
    id, userId, values.title, values.body, values.url,
    values.schedule_type, values.time_of_day, values.days_of_week,
    values.interval_minutes, values.run_at,
    values.quiet_from, values.quiet_to, values.max_occurrences,
    nextRunAt, values.is_active, now
  ).run();

  return c.json({ id, nextRunAt, summary: describeSchedule(values), success: true });
});

// PUT /api/scheduled-notifications/:id — replace a reminder definition
app.put('/:id', async (c) => {
  const userId = c.get('user').sub;
  const id = c.req.param('id');
  const payload = await c.req.json<NotificationBody>().catch((): NotificationBody => ({}));

  const existing = await c.env.DB.prepare(
    'SELECT * FROM scheduled_notifications WHERE id = ?1 AND user_id = ?2'
  ).bind(id, userId).first<ScheduledNotificationRow>();

  if (!existing) return c.json({ error: 'pengingat tidak ditemukan' }, 404);

  // Merge onto the stored row so a partial update keeps the untouched fields
  const normalized = normalize({
    title: payload.title ?? existing.title,
    body: payload.body ?? existing.body,
    url: payload.url !== undefined ? payload.url : existing.url,
    schedule_type: payload.schedule_type ?? existing.schedule_type,
    time_of_day: payload.time_of_day !== undefined ? payload.time_of_day : existing.time_of_day,
    days_of_week: payload.days_of_week !== undefined ? payload.days_of_week : existing.days_of_week,
    interval_minutes: payload.interval_minutes !== undefined ? payload.interval_minutes : existing.interval_minutes,
    run_at: payload.run_at !== undefined ? payload.run_at : existing.run_at,
    quiet_from: payload.quiet_from !== undefined ? payload.quiet_from : existing.quiet_from,
    quiet_to: payload.quiet_to !== undefined ? payload.quiet_to : existing.quiet_to,
    max_occurrences: payload.max_occurrences !== undefined ? payload.max_occurrences : existing.max_occurrences,
    is_active: payload.is_active !== undefined ? payload.is_active : existing.is_active,
  });

  if ('error' in normalized) return c.json({ error: normalized.error }, 400);
  const { values } = normalized;

  const now = Math.floor(Date.now() / 1000);
  const nextRunAt = values.is_active === 1 ? computeNextRun(values, now) : null;

  if (values.is_active === 1 && nextRunAt === null) {
    return c.json({ error: 'jadwal tidak menghasilkan waktu kirim berikutnya' }, 400);
  }

  await c.env.DB.prepare(`
    UPDATE scheduled_notifications SET
      title = ?1, body = ?2, url = ?3,
      schedule_type = ?4, time_of_day = ?5, days_of_week = ?6,
      interval_minutes = ?7, run_at = ?8,
      quiet_from = ?9, quiet_to = ?10, max_occurrences = ?11,
      next_run_at = ?12, is_active = ?13
    WHERE id = ?14
  `).bind(
    values.title, values.body, values.url,
    values.schedule_type, values.time_of_day, values.days_of_week,
    values.interval_minutes, values.run_at,
    values.quiet_from, values.quiet_to, values.max_occurrences,
    nextRunAt, values.is_active, id
  ).run();

  return c.json({ id, nextRunAt, summary: describeSchedule(values), success: true });
});

// POST /api/scheduled-notifications/:id/toggle — pause or resume
app.post('/:id/toggle', async (c) => {
  const userId = c.get('user').sub;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM scheduled_notifications WHERE id = ?1 AND user_id = ?2'
  ).bind(id, userId).first<ScheduledNotificationRow>();

  if (!row) return c.json({ error: 'pengingat tidak ditemukan' }, 404);

  const nowActive = row.is_active === 1 ? 0 : 1;
  const now = Math.floor(Date.now() / 1000);
  const nextRunAt = nowActive === 1 ? computeNextRun(row, now) : null;

  if (nowActive === 1 && nextRunAt === null) {
    return c.json({ error: 'jadwal sudah selesai — ubah jadwalnya untuk mengaktifkan lagi' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE scheduled_notifications SET is_active = ?1, next_run_at = ?2 WHERE id = ?3'
  ).bind(nowActive, nextRunAt, id).run();

  return c.json({ id, isActive: nowActive === 1, nextRunAt, success: true });
});

// POST /api/scheduled-notifications/:id/send-now — fire immediately, schedule untouched
app.post('/:id/send-now', async (c) => {
  const userId = c.get('user').sub;
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM scheduled_notifications WHERE id = ?1 AND user_id = ?2'
  ).bind(id, userId).first<ScheduledNotificationRow>();

  if (!row) return c.json({ error: 'pengingat tidak ditemukan' }, 404);

  const result = await deliverScheduledNotification(c.env, row);

  if (result.status === 'no_subscription') {
    return c.json({ error: 'belum ada perangkat yang berlangganan notifikasi' }, 400);
  }

  return c.json({ success: result.status === 'sent', ...result });
});

// DELETE /api/scheduled-notifications/:id
app.delete('/:id', async (c) => {
  const userId = c.get('user').sub;
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM scheduled_notifications WHERE id = ?1 AND user_id = ?2'
  ).bind(id, userId).first();

  if (!existing) return c.json({ error: 'pengingat tidak ditemukan' }, 404);

  await c.env.DB.prepare('DELETE FROM scheduled_notifications WHERE id = ?1').bind(id).run();
  return c.json({ success: true });
});

export default app;
