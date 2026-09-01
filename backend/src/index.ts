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
import foodSearch from './routes/food_search';
import notifications from './routes/notifications';
import menstrual from './routes/menstrual';
import shortcut from './routes/shortcut';
import shortcuts from './routes/shortcuts';
import bankAccounts from './routes/bank_accounts';
import inventory from './routes/inventory';
import kidsSchedule from './routes/kids_schedule';
import debts from './routes/debts';
import financeReport from './routes/finance_report';
import netWorth from './routes/net_worth';
import weeklyReview, { getMondayOf } from './routes/weekly_review';
import monthlyReview from './routes/monthly_review';
import garden, { computeCareState, lastActions, resolvePlants, type PlantingRow } from './routes/garden';
import gardenExtra from './routes/garden_extra';
import gardenExtra2 from './routes/garden_extra2';
import gardenExtra3 from './routes/garden_extra3';
import gardenExtra4 from './routes/garden_extra4';
import gardenUnit from './routes/garden_unit';
import gardenGrowth from './routes/garden_growth';
import ternak from './routes/ternak';
import ternakCare, { jadwalPengguna } from './routes/ternak_care';
import ternakCatalog from './routes/ternak_catalog';
import ternakHealth from './routes/ternak_health';
import ternakAi from './routes/ternak_ai';
import { HARI_TES_AIR } from './lib/ternak_air';
import { getRain, shouldSkipWatering, wateringNote } from './lib/garden_weather';
import { findSuccessionDue, type ActivePlanting } from './lib/garden_succession';
import { pendingReviews } from './lib/garden_treatment';
import { forecastHarvest, expectedCareCount } from './lib/garden_harvest_forecast';
import { classifyWeather } from './lib/garden_weather_events';
import { HARI_GANTI_LARUTAN } from './lib/garden_media';
import { mangsaPada } from './lib/garden_mangsa';
import { claimDailyAlert, releaseDailyAlert } from './lib/daily_alert';
import { loadSettings, num, bool } from './lib/settings';
import { PLANT_BY_ID, dipanen } from './data/plants';
import achievements from './routes/achievements';
import insights from './routes/insights';
import quickadd from './routes/quickadd';
import search from './routes/search';
import notes from './routes/notes';
import daily from './routes/daily';
import settingsRoute from './routes/settings';
import agent from './routes/agent';
import cooking from './routes/cooking';
import ibadah from './routes/ibadah';
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
import calendar, { occursOn, type CalendarRow } from './routes/calendar';
import holidays from './routes/holidays';
import { syncHolidays } from './lib/holiday_source';
import { computeNextRun } from './lib/schedule';
import { advanceDate, jakartaToday } from './lib/validate';
import { nanoid } from './lib/nanoid';
import { daysBetween, shiftDate } from './lib/daily';
import {
  triggerBillRadar,
  triggerKidsPrep,
  triggerMissTwice,
  triggerMorningBrief,
} from './lib/daily_push';

/**
 * Jeda sebelum bibit yang baru berkecambah layak diingatkan untuk dipindah.
 *
 * Memindahkan kecambah di hari yang sama ia dihitung justru mematikannya —
 * akarnya belum cukup untuk menahan guncangan pindah media.
 */
const TRANSPLANT_READY_DAYS = 7;

/** Sejauh mana ke depan panen layak diingatkan. Terlalu jauh berarti diabaikan. */
const HARVEST_NOTICE_DAYS = 3;

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
app.route('/api/food', foodSearch);
app.route('/api/notifications', notifications);
app.route('/api/menstrual', menstrual);
app.route('/api/shortcut', shortcut);
app.route('/api/shortcuts', shortcuts);
app.route('/api/bank-accounts', bankAccounts);
app.route('/api/inventory', inventory);
app.route('/api/kids-schedule', kidsSchedule);
app.route('/api/debts', debts);
app.route('/api/finance-report', financeReport);
app.route('/api/net-worth', netWorth);
app.route('/api/weekly-review', weeklyReview);
app.route('/api/monthly-review', monthlyReview);
// Dipasang sebelum router kebun utama: garden.ts punya rute /:id yang akan
// menelan /companions, /seeds, dan kawan-kawan kalau ia dicocokkan lebih dulu.
app.route('/api/garden', gardenExtra);
app.route('/api/garden', gardenExtra2);
app.route('/api/garden', gardenExtra3);
app.route('/api/garden', gardenExtra4);
app.route('/api/garden', gardenUnit);
app.route('/api/garden', gardenGrowth);
app.route('/api/garden', garden);
app.route('/api/ternak', ternakCatalog);   // /katalog dan /katalog/:animalId
app.route('/api/ternak', ternakHealth);    // /ukur/:id, /air/:id, /kepadatan, /karantina
app.route('/api/ternak', ternakAi);        // /diagnosa, /tanya
app.route('/api/ternak', ternakCare);
app.route('/api/ternak', ternak);   // ternak.ts punya /kandang/:id, dipasang terakhir
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
app.route('/api/notes', notes);
app.route('/api/daily', daily);
app.route('/api/settings', settingsRoute);
app.route('/api/agent', agent);
app.route('/api/cooking', cooking);
app.route('/api/ibadah', ibadah);

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

/** "HH:MM" the given minutes before `eventTime`, or null if that crosses into the previous day. */
function reminderClockTime(eventTime: string, minutesBefore: number): string | null {
  const [h, m] = eventTime.split(':').map(Number);
  const total = h * 60 + m - minutesBefore;
  if (total < 0) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Push a calendar event's own reminder — remind_minutes_before was captured
// by the form since the feature shipped, but nothing ever read it until now.
// Fires once per (event, occurrence date): a repeating event reminds on
// every occurrence, not just once ever, via calendar_reminder_sent.
async function triggerCalendarReminders(env: Env) {
  const now = new Date();
  const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hhmm = `${String(jakartaTime.getUTCHours()).padStart(2, '0')}:${String(jakartaTime.getUTCMinutes()).padStart(2, '0')}`;
  const today = jakartaToday();

  const due = await env.DB.prepare(`
    SELECT DISTINCT ce.id, ce.user_id, ce.title, ce.note, ce.event_date, ce.event_time,
           ce.repeat_rule, ce.repeat_until, ce.remind_minutes_before
    FROM calendar_events ce
    JOIN push_subscriptions s ON ce.user_id = s.user_id
    WHERE ce.remind_minutes_before IS NOT NULL
      AND ce.event_time IS NOT NULL
      AND ce.is_done = 0
  `).all<{
    id: string; user_id: string; title: string; note: string | null;
    event_date: string; event_time: string; repeat_rule: string;
    repeat_until: string | null; remind_minutes_before: number;
  }>();

  for (const row of due.results ?? []) {
    // Simplification, deliberate: a reminder whose minutes-before crosses
    // back into the previous day (e.g. 60 min before a 00:30 event) never
    // fires. Same-day reminders are the overwhelming common case; matching
    // "yesterday evening" against "today's occurrence" is a second lookup
    // this doesn't attempt.
    const fireAt = reminderClockTime(row.event_time, row.remind_minutes_before);
    if (fireAt !== hhmm) continue;

    const occursToday = row.repeat_rule === 'none'
      ? row.event_date === today
      : occursOn(row as unknown as CalendarRow, today);
    if (!occursToday) continue;

    // The unique (event_id, occurrence_date) key makes a repeat tick, or an
    // overlapping run, a no-op rather than a double send.
    try {
      await env.DB.prepare(
        'INSERT INTO calendar_reminder_sent (event_id, occurrence_date) VALUES (?1, ?2)'
      ).bind(row.id, today).run();
    } catch {
      continue;
    }

    const title = '📅 Pengingat Kalender';
    const body = row.note ? `${row.title} — ${row.note}` : row.title;

    await queueNotificationEvent(env, row.user_id, 'calendar_reminder', title, body, {
      eventId: row.id,
      url: '/kalender',
    });
    await sendPushToUser(env, row.user_id, { title, body, url: '/kalender' });
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

  // Digeser sepenuhnya di UTC. Versi sebelumnya membangun tanggalnya di UTC
  // (`new Date('YYYY-MM-DD')`), menggesernya dengan setter WAKTU LOKAL, lalu
  // membacanya lagi lewat `toISOString()` yang UTC. Campuran itu meleset
  // sehari kalau pergeserannya melewati batas DST — benar di produksi hanya
  // karena Workers berjalan di UTC, dan diam-diam salah di mana pun tidak.
  const threeDaysFromNow = shiftDate(today, 3);

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

  // Weekly-frequency habits are excluded: "not done today" isn't a risk to
  // a habit whose streak is measured in weeks, not days.
  const atRisk = await env.DB.prepare(`
    SELECT h.id, h.name, h.user_id, h.streak
    FROM habits h
    JOIN push_subscriptions s ON h.user_id = s.user_id
    LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
    WHERE h.streak > 0
      AND (hf.frequency_type IS NULL OR hf.frequency_type != 'weekly')
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
      SELECT h.id, h.streak, hf.frequency_type, hf.target_per_week,
             COUNT(hc.id) as completions_this_week
      FROM habits h
      LEFT JOIN habit_frequency hf ON hf.habit_id = h.id
      LEFT JOIN habit_completions hc
        ON hc.habit_id = h.id AND hc.completed_date BETWEEN ?2 AND ?3 AND hc.user_id = h.user_id
      WHERE h.user_id = ?1
      GROUP BY h.id
    `).bind(userId, weekStart, today).all<{
      id: string; streak: number; frequency_type: string | null; target_per_week: number | null;
      completions_this_week: number;
    }>();

    const habits = habitStats.results ?? [];
    // Nothing tracked yet — a recap of zero habits isn't worth a push, and
    // marking it sent would stop it from ever nudging the user once they add one.
    if (habits.length === 0) continue;

    // Each habit's own target is its possible max for the week — 7 for a
    // daily habit, target_per_week for a weekly one — so a 3x/week habit
    // doesn't drag the aggregate down for simply not being daily.
    const possibleFor = (h: (typeof habits)[number]) =>
      h.frequency_type === 'weekly' && h.target_per_week ? h.target_per_week : 7;
    const totalCompletions = habits.reduce((s, h) => s + Math.min(h.completions_this_week, possibleFor(h)), 0);
    const possibleCompletions = habits.reduce((s, h) => s + possibleFor(h), 0);
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

// Pengingat perawatan kebun, satu push agregat per pengguna tiap pagi.
//
// Jadwalnya diturunkan dari log perawatan (computeCareState), bukan dari kolom
// "next_water" yang disimpan — jadi mencatat siram lewat aplikasi langsung
// menggeser pengingat besoknya tanpa ada state kedua yang bisa basi.
// Dedup lewat garden_care_alert_sent (planting_id, alert_date): sekali
// diingatkan per tanaman per hari, walau cron menyala tiap menit.
async function triggerGardenCare(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  // Hanya pengguna yang punya push subscription — sisanya tidak ada gunanya dihitung.
  const users = await env.DB.prepare(`
    SELECT DISTINCT g.user_id
    FROM garden_plantings g
    JOIN push_subscriptions s ON s.user_id = g.user_id
    WHERE g.status IN ('tumbuh', 'panen')
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    // Jam dan sakelar diperiksa per pengguna: dua orang bisa memilih jam
    // berbeda, dan cron menyala tiap menit sehingga semua jam terlewati.
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.garden_care')) continue;
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    // Cuaca diambil sekali per pengguna, bukan per tanaman: satu kebun ada di
    // satu lokasi, dan Open-Meteo dibatasi kuota harian.
    const location = await env.DB.prepare(
      'SELECT latitude, longitude FROM garden_location WHERE user_id = ?1'
    ).bind(userId).first<{ latitude: number; longitude: number }>();

    const rain = location
      ? await getRain(env.DB, location.latitude, location.longitude, today)
      : null;

    // Tidak tahu cuaca bukan berarti kering. Tanpa data, pengingat berjalan
    // seperti sebelumnya — melewatkan siram karena tebakan lebih berbahaya
    // daripada menyiram saat sudah agak basah.
    const rainVerdict = rain
      ? shouldSkipWatering(rain, {
          skipMm: num(settings, 'garden.rain_skip_mm'),
          soakedMm: num(settings, 'garden.rain_soaked_mm'),
        })
      : { skip: false, reason: '' };
    const rainNote = rain ? wateringNote(rain, num(settings, 'garden.rain_skip_mm')) : null;
    // Cuaca ekstrem disebut terpisah dari anjuran siram: hujan 60 mm bukan
    // sekadar "tidak perlu menyiram", melainkan alasan memeriksa genangan —
    // dan itu penjelasan yang selama ini hilang saat tanaman tiba-tiba mati.
    const weatherEvent = rain ? classifyWeather(rain) : { kind: 'normal' as const, note: '' };

    const [rows, lastMap] = await Promise.all([
      env.DB.prepare(
        `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
                planted_date, expected_harvest_date, status, note
         FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
      ).bind(userId).all<PlantingRow>(),
      lastActions(env.DB, userId),
    ]);

    const plantings = rows.results ?? [];
    if (plantings.length === 0) continue;

    const plantMap = await resolvePlants(
      env.DB,
      [...new Set(plantings.map(p => p.plant_id).filter((id): id is string => !!id))]
    );

    let rainSkipped = 0;
    const water: string[] = [];
    const fertilize: string[] = [];
    const harvest: string[] = [];
    const touched: string[] = [];

    for (const p of plantings) {
      const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
      const care = computeCareState(p, plant, lastMap.get(p.id) ?? {}, today);
      const label = p.nickname || plant?.name || p.custom_name || 'Tanaman';

      const wantsWater = care.nextWater !== null && care.nextWater <= today;
      const dueWater = wantsWater && !rainVerdict.skip;
      if (wantsWater && rainVerdict.skip) rainSkipped++;
      const dueFertilize = care.nextFertilize !== null && care.nextFertilize <= today;
      if (!dueWater && !dueFertilize && !care.harvestReady) continue;

      // Sudah diingatkan hari ini? INSERT gagal karena primary key, lalu dilewati.
      try {
        await env.DB.prepare(
          'INSERT INTO garden_care_alert_sent (planting_id, alert_date) VALUES (?1, ?2)'
        ).bind(p.id, today).run();
      } catch {
        continue;
      }

      if (dueWater) water.push(label);
      if (dueFertilize) fertilize.push(label);
      if (care.harvestReady) harvest.push(label);
      touched.push(p.id);
    }

    if (touched.length === 0) continue;

    const parts: string[] = [];
    if (water.length) parts.push(`💧 Siram: ${water.join(', ')}`);
    if (water.length && rainNote) parts.push(rainNote);
    // Siram yang dilewati karena hujan tetap disebut. Pengingat yang diam
    // tanpa penjelasan terbaca sebagai fitur yang rusak.
    if (rainSkipped > 0) parts.push(`☔ ${rainSkipped} tanaman tidak perlu disiram. ${rainVerdict.reason}`);
    if (fertilize.length) parts.push(`🌿 Pupuk: ${fertilize.join(', ')}`);
    if (harvest.length) parts.push(`🧺 Siap panen: ${harvest.join(', ')}`);
    if (weatherEvent.note) parts.push(`⚠️ ${weatherEvent.note}`);

    const title = harvest.length > 0 ? '🧺 Ada yang siap dipanen!' : '🌱 Kebun perlu dirawat';
    const body = parts.join('\n');

    await queueNotificationEvent(env, userId, 'garden_care', title, body, {
      water, fertilize, harvest, url: '/lainnya',
    });
    await sendPushToUser(env, userId, { title, body, url: '/lainnya' });
  }
}

// Pengingat menyemai batch berikutnya untuk tanaman sekali cabut.
//
// Jam 7 bersama pengingat perawatan supaya kebun cukup satu kali membuka
// ponsel. Dedup lewat daily_alert_sent — semai bukan urusan per tanaman,
// melainkan satu keputusan sekali sehari.
async function triggerSuccession(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT g.user_id
    FROM garden_plantings g
    JOIN push_subscriptions s ON s.user_id = g.user_id
    WHERE g.status IN ('tumbuh', 'panen')
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.succession')) continue;
    // Ikut jam perawatan kebun — dua push kebun di jam berbeda hanya
    // menggandakan gangguan tanpa menambah informasi.
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    const rows = await env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
              planted_date, expected_harvest_date, status, note
       FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
    ).bind(userId).all<PlantingRow>();

    const plantings = rows.results ?? [];
    if (plantings.length === 0) continue;

    const [plantMap, lastMap] = await Promise.all([
      resolvePlants(env.DB, [...new Set(plantings.map(p => p.plant_id).filter((id): id is string => !!id))]),
      lastActions(env.DB, userId),
    ]);

    const active: ActivePlanting[] = plantings.map(p => {
      const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
      const care = computeCareState(p, plant, lastMap.get(p.id) ?? {}, today);
      return {
        id: p.id,
        plantId: p.plant_id,
        label: p.nickname || plant?.name || p.custom_name || 'Tanaman',
        nextHarvest: care.nextHarvest,
      };
    });

    const due = findSuccessionDue(active, PLANT_BY_ID, today, num(settings, 'garden.succession_days'));
    if (due.length === 0) continue;

    const lines = due.map(d => {
      const when = d.daysUntilSow < 0
        ? `sudah lewat ${Math.abs(d.daysUntilSow)} hari`
        : 'hari ini';
      return `${d.emoji} ${d.label} — semai batch berikutnya, ${when}`;
    });

    const title = '🌱 Waktunya semai batch berikutnya';
    const body = `${lines.join('\n')}\nSupaya panen bersambung, bukan kosong berminggu-minggu.`;

    if (!(await claimDailyAlert(env.DB, userId, 'succession', today))) continue;

    await queueNotificationEvent(env, userId, 'succession', title, body, {
      plantings: due.map(d => ({ id: d.plantingId, label: d.label })),
      url: '/lainnya',
    });
    const result = await sendPushToUser(env, userId, { title, body, url: '/lainnya' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'succession', today);
    }
  }
}

/**
 * Menagih penilaian penanganan hama, dan mengingatkan bibit yang sudah siap
 * dipindah tanam.
 *
 * Keduanya digabung dalam satu push karena sama-sama pekerjaan kebun yang
 * tidak mendesak per jam tapi hilang kalau tidak pernah ditanyakan. Kolom
 * `worked` di garden_pest_log sudah ada sejak awal namun selalu kosong justru
 * karena tidak ada yang pernah menagihnya; ini yang menutup lingkarannya.
 */
async function triggerGardenFollowUp(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT s.user_id
    FROM push_subscriptions s
    WHERE EXISTS (SELECT 1 FROM garden_pest_log p WHERE p.user_id = s.user_id AND p.worked IS NULL)
       OR EXISTS (
            SELECT 1 FROM garden_sowings g
             WHERE g.user_id = s.user_id
               AND g.germinated_count > 0
               AND g.transplanted_date IS NULL
          )
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    // Dua sakelar, bukan satu. Sakelar induk Perawatan Kebun tetap dihormati:
    // pengguna yang sudah mematikannya tidak boleh tiba-tiba menerima jenis
    // push baru hanya karena sakelar barunya berdefault menyala. Sakelar
    // sendiri memungkinkan mematikan tindak lanjut tanpa ikut mematikan siram.
    if (!bool(settings, 'notify.garden_care')) continue;
    if (!bool(settings, 'notify.garden_followup')) continue;
    // Jamnya ikut Perawatan Kebun — satu waktu buka ponsel untuk semua urusan kebun.
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    const [pestRows, sowRows] = await Promise.all([
      env.DB.prepare(
        `SELECT pest, treatment, spotted_date FROM garden_pest_log
          WHERE user_id = ?1 AND worked IS NULL`
      ).bind(userId).all<{ pest: string; treatment: string | null; spotted_date: string }>(),
      env.DB.prepare(
        `SELECT name, germinated_count, germinated_date FROM garden_sowings
          WHERE user_id = ?1 AND germinated_count > 0 AND transplanted_date IS NULL`
      ).bind(userId).all<{ name: string; germinated_count: number; germinated_date: string | null }>(),
    ]);

    const reviews = pendingReviews(
      (pestRows.results ?? []).map((r) => ({
        pest: r.pest,
        treatment: r.treatment,
        worked: null,
        spottedDate: r.spotted_date,
        resolvedDate: null,
      })),
      today
    );

    // Bibit baru layak diingatkan setelah beberapa hari, bukan di hari yang
    // sama ia dihitung — memindahkan kecambah yang masih terlalu muda justru
    // membunuhnya.
    const readySeedlings = (sowRows.results ?? []).filter(
      (r) => r.germinated_date !== null && daysBetween(r.germinated_date, today) >= TRANSPLANT_READY_DAYS
    );

    if (reviews.length === 0 && readySeedlings.length === 0) continue;

    const lines: string[] = [];
    for (const r of reviews.slice(0, 3)) {
      lines.push(`🧪 ${r.pest}${r.treatment ? ` (${r.treatment})` : ''} — berhasil? sudah ${r.daysSince} hari`);
    }
    for (const s of readySeedlings.slice(0, 3)) {
      lines.push(`🌱 ${s.germinated_count} bibit ${s.name} siap dipindah tanam`);
    }

    const title = reviews.length > 0 && readySeedlings.length > 0
      ? '🌿 Kebun perlu ditengok'
      : reviews.length > 0
        ? '🧪 Penanganan hama berhasil?'
        : '🌱 Bibit siap pindah tanam';
    const body = lines.join('\n');

    if (!(await claimDailyAlert(env.DB, userId, 'garden_followup', today))) continue;

    await queueNotificationEvent(env, userId, 'garden_followup', title, body, { url: '/kebun' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/kebun' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'garden_followup', today);
    }
  }
}

/**
 * Pengingat menjelang panen.
 *
 * Memakai perkiraan adaptif, bukan tanggal katalog: tanaman yang perawatannya
 * tertinggal memang belum siap dipanen di tanggal brosurnya, dan diingatkan
 * terlalu awal justru mengajari pengguna mengabaikan notifikasi.
 */
async function triggerHarvestDue(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT g.user_id
    FROM garden_plantings g
    JOIN push_subscriptions s ON s.user_id = g.user_id
    WHERE g.status = 'tumbuh'
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    // Alasan sama dengan tindak lanjut: sakelar induk tetap berlaku.
    if (!bool(settings, 'notify.garden_care')) continue;
    if (!bool(settings, 'notify.harvest_due')) continue;
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    const [plantingRes, careRes] = await Promise.all([
      env.DB.prepare(
        `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
                planted_date, expected_harvest_date, status, note
           FROM garden_plantings WHERE user_id = ?1 AND status = 'tumbuh'`
      ).bind(userId).all<PlantingRow>(),
      env.DB.prepare(
        `SELECT planting_id, action, COUNT(*) AS n FROM garden_care_log
          WHERE user_id = ?1 AND action IN ('siram','pupuk') GROUP BY planting_id, action`
      ).bind(userId).all<{ planting_id: string; action: string; n: number }>(),
    ]);

    const rows = plantingRes.results ?? [];
    if (rows.length === 0) continue;

    const plants = await resolvePlants(
      env.DB, rows.map((r) => r.plant_id).filter((id): id is string => !!id)
    );

    const counts = new Map<string, { siram: number; pupuk: number }>();
    for (const r of careRes.results ?? []) {
      const e = counts.get(r.planting_id) ?? { siram: 0, pupuk: 0 };
      if (r.action === 'siram') e.siram = r.n;
      if (r.action === 'pupuk') e.pupuk = r.n;
      counts.set(r.planting_id, e);
    }

    const due: string[] = [];
    for (const row of rows) {
      const plant = row.plant_id ? plants.get(row.plant_id) : undefined;
      // Tanaman hias tidak dipanen, jadi tidak ada perkiraan panen yang bisa
      // dikirim — pengingat "monsteramu siap panen" adalah pengingat yang
      // membuat semua pengingat lain ikut diragukan.
      if (!plant || !dipanen(plant)) continue;

      const actual = counts.get(row.id) ?? { siram: 0, pupuk: 0 };
      const forecast = forecastHarvest(
        row.planted_date,
        plant.daysToHarvest[0],
        {
          waterExpected: expectedCareCount(row.planted_date, today, plant.waterIntervalDays),
          waterActual: actual.siram,
          fertilizeExpected: expectedCareCount(row.planted_date, today, plant.fertilizeIntervalDays),
          fertilizeActual: actual.pupuk,
        },
        today,
        row.expected_harvest_date
      );

      const daysUntil = daysBetween(today, forecast.estimatedDate);
      if (daysUntil < 0 || daysUntil > HARVEST_NOTICE_DAYS) continue;

      const label = row.nickname || plant.name || row.custom_name || 'Tanaman';
      const when = daysUntil === 0 ? 'hari ini' : `${daysUntil} hari lagi`;
      due.push(`${plant.emoji} ${label} — perkiraan panen ${when}`);
    }

    if (due.length === 0) continue;

    const title = '🧺 Menjelang panen';
    const body = `${due.join('\n')}\nSiapkan wadah dan waktu memanennya.`;

    if (!(await claimDailyAlert(env.DB, userId, 'harvest_due', today))) continue;

    await queueNotificationEvent(env, userId, 'harvest_due', title, body, { url: '/kebun' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/kebun' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'harvest_due', today);
    }
  }
}

/**
 * Ganti larutan hidroponik.
 *
 * Media hidroponik sudah tercatat sejak migrasi 0037 dan `tugasMedia` sudah
 * bisa menghitung tenggangnya, tapi hasilnya hanya terlihat kalau pengguna
 * kebetulan membuka layar tanaman itu. Padahal inilah tenggang kebun yang
 * paling tidak memaafkan: larutan yang dibiarkan menumpuk garam sampai
 * meracuni akar, sementara tanamannya tetap terlihat sehat sampai hari ia
 * layu semuanya sekaligus.
 */
async function triggerSolutionChange(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT m.user_id
    FROM garden_planting_media m
    JOIN push_subscriptions s ON s.user_id = m.user_id
    JOIN garden_plantings g ON g.id = m.planting_id
    WHERE m.media = 'hidroponik' AND g.status IN ('tumbuh', 'panen')
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.garden_care')) continue;
    if (!bool(settings, 'notify.garden_solution')) continue;
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    const rows = await env.DB.prepare(
      `SELECT g.id, g.plant_id, g.custom_name, g.nickname, m.last_solution_change
         FROM garden_planting_media m
         JOIN garden_plantings g ON g.id = m.planting_id
        WHERE m.user_id = ?1 AND m.media = 'hidroponik' AND g.status IN ('tumbuh', 'panen')`
    ).bind(userId).all<{
      id: string; plant_id: string | null; custom_name: string | null;
      nickname: string | null; last_solution_change: string | null;
    }>();

    const lines: string[] = [];
    for (const r of rows.results ?? []) {
      // Belum pernah dicatat bukan berarti baru diganti. Diamkan sekali saja,
      // dan larutan yang tak pernah tercatat tidak akan pernah ditagih.
      const umur = r.last_solution_change ? daysBetween(r.last_solution_change, today) : null;
      if (umur !== null && umur < HARI_GANTI_LARUTAN) continue;

      const label = r.nickname
        || (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.name : null)
        || r.custom_name
        || 'Tanaman';
      lines.push(umur === null
        ? `💧 ${label} — larutan belum pernah dicatat gantinya`
        : `💧 ${label} — larutan sudah ${umur} hari`);
    }

    if (lines.length === 0) continue;

    const title = '💧 Ganti larutan hidroponik';
    const body = `${lines.slice(0, 5).join('\n')}\nBuang larutan lama, bilas bak, isi ulang, lalu cek EC dan pH.`;

    if (!(await claimDailyAlert(env.DB, userId, 'garden_solution', today))) continue;

    await queueNotificationEvent(env, userId, 'garden_solution', title, body, { url: '/kebun' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/kebun' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'garden_solution', today);
    }
  }
}

/**
 * Pergantian mangsa.
 *
 * Dikirim hanya pada hari pertama tiap mangsa — dua belas kali setahun. Saran
 * tanamnya memang berubah tepat di hari itu, dan tanpa pengingat pergantian
 * mangsa hanya terlihat kalau pengguna kebetulan membuka layarnya hari itu
 * juga.
 */
async function triggerMangsaChange(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const sekarang = mangsaPada(today);
  // Perbandingan pada MM-DD: tanggal mulai mangsa sama tiap tahun.
  if (sekarang.mulai !== today.slice(5)) return;

  const users = await env.DB.prepare(`
    SELECT DISTINCT s.user_id FROM push_subscriptions s
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.garden_care')) continue;
    if (!bool(settings, 'notify.garden_mangsa')) continue;
    if (num(settings, 'notify.garden_care.hour') !== nowHour) continue;

    const title = `🗓️ Mangsa ${sekarang.nama} dimulai`;
    const body = `${sekarang.pertanda}\n\n${sekarang.saran}`;

    if (!(await claimDailyAlert(env.DB, userId, 'garden_mangsa', today))) continue;

    await queueNotificationEvent(env, userId, 'garden_mangsa', title, body, { url: '/kebun' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/kebun' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'garden_mangsa', today);
    }
  }
}

/**
 * Pengingat perawatan ternak harian: tugas jatuh tempo yang bukan kategori
 * mendesak (lihat triggerTernakPenting untuk itu).
 *
 * Memakai jadwalPengguna, bukan menghitung ulang sendiri — alasan yang sama
 * dengan getTernakToday: dua hitungan untuk pertanyaan yang sama pasti
 * menyimpang.
 */
async function triggerTernakCare(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  // Hanya pengguna yang punya push subscription DAN benar-benar punya
  // kandang atau hewan — sisanya tidak ada gunanya dihitung.
  const users = await env.DB.prepare(`
    SELECT DISTINCT s.user_id
      FROM push_subscriptions s
     WHERE EXISTS (SELECT 1 FROM ternak_kandang k WHERE k.user_id = s.user_id AND k.status = 'aktif')
        OR EXISTS (SELECT 1 FROM ternak_hewan h WHERE h.user_id = s.user_id AND h.status = 'hidup')
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.ternak')) continue;
    if (num(settings, 'notify.ternak.hour') !== nowHour) continue;

    const semua = await jadwalPengguna(env.DB, userId, today);
    // Tugas penting dikirim terpisah lewat triggerTernakPenting supaya tidak
    // tenggelam di bawah tugas rutin seperti potong kuku.
    const jatuhTempo = semua.filter((t) => t.berikutnya <= today && !t.penting);
    if (jatuhTempo.length === 0) continue;

    const lines = jatuhTempo.slice(0, 8).map((t) => `🐾 ${t.nama} — ${t.labelTugas}`);
    const title = `🐾 ${jatuhTempo.length} tugas ternak jatuh tempo`;
    const body = lines.join('\n');

    if (!(await claimDailyAlert(env.DB, userId, 'ternak_care', today))) continue;

    await queueNotificationEvent(env, userId, 'ternak_care', title, body, { url: '/ternak' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/ternak' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'ternak_care', today);
    }
  }
}

/**
 * Tugas yang kelalaiannya berujung mati, dikirim terpisah.
 *
 * Digabung ke pengingat harian biasa, "ganti lampu UVB" akan berada di baris
 * keenam di bawah "potong kuku" dan tenggelam. Pemisahan inilah gunanya
 * kolom `penting` di katalog.
 */
async function triggerTernakPenting(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT s.user_id
      FROM push_subscriptions s
     WHERE EXISTS (SELECT 1 FROM ternak_kandang k WHERE k.user_id = s.user_id AND k.status = 'aktif')
        OR EXISTS (SELECT 1 FROM ternak_hewan h WHERE h.user_id = s.user_id AND h.status = 'hidup')
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    // Sakelar induk tetap dihormati: mematikan modul Ternak mematikan semua
    // pengingatnya sekaligus, termasuk yang mendesak ini.
    if (!bool(settings, 'notify.ternak')) continue;
    if (!bool(settings, 'notify.ternak_penting')) continue;
    if (num(settings, 'notify.ternak.hour') !== nowHour) continue;

    const semua = await jadwalPengguna(env.DB, userId, today);
    const jatuhTempo = semua.filter((t) => t.berikutnya <= today && t.penting);
    if (jatuhTempo.length === 0) continue;

    const lines = jatuhTempo.slice(0, 8).map((t) => `⚠️ ${t.nama} — ${t.labelTugas}`);
    const title = '⚠️ Tugas ternak mendesak';
    const body = lines.join('\n');

    if (!(await claimDailyAlert(env.DB, userId, 'ternak_penting', today))) continue;

    await queueNotificationEvent(env, userId, 'ternak_penting', title, body, { url: '/ternak' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/ternak' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'ternak_penting', today);
    }
  }
}

/** Kandang berair yang lebih dari HARI_TES_AIR tidak dites, atau belum pernah. */
async function triggerTernakAir(env: Env) {
  const nowHour = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
  const today = jakartaToday();

  const users = await env.DB.prepare(`
    SELECT DISTINCT k.user_id
      FROM ternak_kandang k
      JOIN push_subscriptions s ON s.user_id = k.user_id
     WHERE k.status = 'aktif' AND k.habitat != 'darat'
  `).all<{ user_id: string }>();

  for (const { user_id: userId } of users.results ?? []) {
    const settings = await loadSettings(env.DB, userId);
    if (!bool(settings, 'notify.ternak')) continue;
    if (!bool(settings, 'notify.ternak_air')) continue;
    if (num(settings, 'notify.ternak.hour') !== nowHour) continue;

    const rows = await env.DB.prepare(`
      SELECT k.id, k.nama,
             (SELECT MAX(a.tanggal) FROM ternak_air a WHERE a.kandang_id = k.id) AS last_test
        FROM ternak_kandang k
       WHERE k.user_id = ?1 AND k.status = 'aktif' AND k.habitat != 'darat'
    `).bind(userId).all<{ id: string; nama: string; last_test: string | null }>();

    const lines: string[] = [];
    for (const r of rows.results ?? []) {
      // Belum pernah dites bukan berarti baru dites. Ditagih sekali saja, dan
      // kandang yang tidak pernah dites tidak akan pernah lolos.
      const umur = r.last_test ? daysBetween(r.last_test, today) : null;
      if (umur !== null && umur < HARI_TES_AIR) continue;

      lines.push(umur === null
        ? `💧 ${r.nama} — air belum pernah dites`
        : `💧 ${r.nama} — air sudah ${umur} hari tidak dites`);
    }

    if (lines.length === 0) continue;

    const title = '💧 Tes air kandang';
    const body = lines.slice(0, 8).join('\n');

    if (!(await claimDailyAlert(env.DB, userId, 'ternak_air', today))) continue;

    await queueNotificationEvent(env, userId, 'ternak_air', title, body, { url: '/ternak' });
    const result = await sendPushToUser(env, userId, { title, body, url: '/ternak' });
    if (result.subscriptions === 0) {
      await releaseDailyAlert(env.DB, userId, 'ternak_air', today);
    }
  }
}

const handler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      triggerReminders(env),
      triggerCalendarReminders(env).catch((err) => console.error('Calendar reminder push failed', err)),
      processScheduledNotifications(env),
      processRecurringBudget(env),
      triggerExpiryAlerts(env),
      triggerStreakAtRisk(env),
      triggerWeeklyRecap(env),
      triggerGardenCare(env).catch((err) => console.error('Garden care push failed', err)),
      triggerSuccession(env).catch((err) => console.error('Succession push failed', err)),
      triggerGardenFollowUp(env).catch((err) => console.error('Garden follow-up push failed', err)),
      triggerHarvestDue(env).catch((err) => console.error('Harvest due push failed', err)),
      triggerSolutionChange(env).catch((err) => console.error('Solution change push failed', err)),
      triggerMangsaChange(env).catch((err) => console.error('Mangsa change push failed', err)),
      triggerTernakCare(env).catch((err) => console.error('Ternak care push failed', err)),
      triggerTernakPenting(env).catch((err) => console.error('Ternak urgent push failed', err)),
      triggerTernakAir(env).catch((err) => console.error('Ternak water test push failed', err)),
      processStreakFreezes(env).catch((err) => console.error('Streak freeze grant failed', err)),
      triggerMorningBrief(env).catch((err) => console.error('Morning brief push failed', err)),
      triggerBillRadar(env).catch((err) => console.error('Bill radar push failed', err)),
      triggerMissTwice(env).catch((err) => console.error('Miss-twice push failed', err)),
      triggerKidsPrep(env).catch((err) => console.error('Kids prep push failed', err)),
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
      // Dedup pengingat kebun hanya perlu berlaku untuk hari berjalan
      env.DB.prepare(
        "DELETE FROM garden_care_alert_sent WHERE sent_at < unixepoch() - 7 * 86400"
      ).run().catch((err) => console.error('Garden alert cleanup failed', err)),
      // Dedup alert harian hanya perlu berlaku untuk hari berjalan
      env.DB.prepare(
        "DELETE FROM daily_alert_sent WHERE sent_at < unixepoch() - 7 * 86400"
      ).run().catch((err) => console.error('Daily alert cleanup failed', err)),
    ]));
  }
};

export default handler;
