import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { jakartaToday } from '../lib/validate';
import { computeSafeToSpend } from '../lib/safe_to_spend';
import {
  getBillRadar,
  getKidsFor,
  getMissedYesterday,
  getExpiringItems,
  shiftDate,
} from '../lib/daily';

const daily = new Hono<AuthContext>();

daily.use('/*', requireAuth);

// GET /api/daily/safe-to-spend — boleh habis berapa hari ini
daily.get('/safe-to-spend', async (c) => {
  const user = c.get('user');
  return c.json(await computeSafeToSpend(c.env.DB, user.sub, jakartaToday()));
});

// GET /api/daily/bills — tagihan jatuh tempo dan rekening yang menutupi
daily.get('/bills', async (c) => {
  const user = c.get('user');
  const within = Number(c.req.query('within') ?? 3);
  return c.json(
    await getBillRadar(c.env.DB, user.sub, jakartaToday(), Number.isFinite(within) ? within : 3)
  );
});

// GET /api/daily/kids — jadwal anak besok (default) atau tanggal yang diminta
daily.get('/kids', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? shiftDate(jakartaToday(), 1);
  return c.json({ date, items: await getKidsFor(c.env.DB, user.sub, date) });
});

// GET /api/daily/missed — kebiasaan yang terancam bolos dua kali
daily.get('/missed', async (c) => {
  const user = c.get('user');
  return c.json({ habits: await getMissedYesterday(c.env.DB, user.sub, jakartaToday()) });
});

// GET /api/daily/brief — ringkasan pagi lintas modul
daily.get('/brief', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const tomorrow = shiftDate(today, 1);

  // Satu putaran paralel: tiap bagian berdiri sendiri, dan brief yang menunggu
  // enam kueri berurutan akan terasa lambat justru di layar pertama pagi hari.
  const [safeToSpend, billRadar, missed, expiring, kidsToday, habitRows, events] = await Promise.all([
    computeSafeToSpend(c.env.DB, user.sub, today),
    getBillRadar(c.env.DB, user.sub, today),
    getMissedYesterday(c.env.DB, user.sub, today),
    getExpiringItems(c.env.DB, user.sub, today),
    getKidsFor(c.env.DB, user.sub, today),
    c.env.DB.prepare(
      `SELECT h.id, h.name, h.action_time, h.streak,
              EXISTS (
                SELECT 1 FROM habit_completions c
                WHERE c.habit_id = h.id AND c.user_id = ?1 AND c.completed_date = ?2
              ) AS done
       FROM habits h
       WHERE h.user_id = ?1
       ORDER BY COALESCE(h.action_time, '99:99') ASC, h.sort_order ASC`
    )
      .bind(user.sub, today)
      .all<{ id: string; name: string; action_time: string | null; streak: number; done: number }>(),
    c.env.DB.prepare(
      `SELECT id, title, event_time, note FROM calendar_events
       WHERE user_id = ?1 AND event_date = ?2 AND is_done = 0
       ORDER BY COALESCE(event_time, '99:99') ASC`
    )
      .bind(user.sub, today)
      .all<{ id: string; title: string; event_time: string | null; note: string | null }>(),
  ]);

  const habits = (habitRows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    time: row.action_time,
    streak: row.streak,
    done: row.done === 1,
  }));

  return c.json({
    date: today,
    tomorrow,
    habits: {
      items: habits,
      pending: habits.filter((h) => !h.done).length,
      total: habits.length,
    },
    events: events.results ?? [],
    safeToSpend,
    bills: billRadar,
    missed,
    expiring,
    kids: kidsToday,
  });
});

export default daily;
