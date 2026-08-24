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
import { suggestRecipes, type AiRunner } from '../lib/rescue';
import { findClashes, type TimedEvent, type TimedHabit } from '../lib/reschedule';
import { findPatterns, type DayRecord } from '../lib/patterns';

/**
 * Agenda tidak menyimpan durasi (lihat 0015_calendar.sql), jadi pengecekan
 * bentrok memakai satu jam sebagai perkiraan. Terlalu panjang berarti
 * mengusulkan pindah yang tidak perlu; terlalu pendek berarti melewatkan
 * bentrok betulan. Satu jam adalah panjang rapat yang paling lazim.
 */
const ASSUMED_EVENT_MINUTES = 60;

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

// POST /api/daily/rescue — usul masakan dari stok yang mau kedaluwarsa
daily.post('/rescue', async (c) => {
  const user = c.get('user');
  const items = await getExpiringItems(c.env.DB, user.sub, jakartaToday());

  if (items.length === 0) {
    return c.json({ items: [], recipes: [], message: 'Tidak ada stok yang mendesak. 🎉' });
  }

  try {
    const recipes = await suggestRecipes(c.env as unknown as AiRunner, items);
    return c.json({ items, recipes });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'ai_error';
    // Daftar bahannya tetap dikembalikan walau AI gagal — mengetahui apa yang
    // harus segera dipakai sudah berguna tanpa saran resep.
    if (code === 'ai_timeout') {
      return c.json({ items, recipes: [], error: 'ai_timeout', message: 'Saran masakan terlalu lama. Coba lagi.' }, 504);
    }
    if (code === 'bad_reply') {
      return c.json({ items, recipes: [], error: 'bad_reply', message: 'Belum bisa menyusun saran dari bahan ini.' }, 502);
    }
    console.error('[daily] rescue gagal:', code);
    return c.json({ items, recipes: [], error: 'ai_error', message: 'Layanan AI sedang bermasalah.' }, 502);
  }
});

// GET /api/daily/reschedule — kebiasaan yang bentrok dengan agenda
daily.get('/reschedule', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? jakartaToday();

  const [habitRows, eventRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, action_time, two_min FROM habits
       WHERE user_id = ?1 AND action_time IS NOT NULL AND action_time != ''`
    )
      .bind(user.sub)
      .all<{ id: string; name: string; action_time: string; two_min: string | null }>(),
    c.env.DB.prepare(
      `SELECT title, event_time FROM calendar_events
       WHERE user_id = ?1 AND event_date = ?2 AND is_done = 0 AND event_time IS NOT NULL`
    )
      .bind(user.sub, date)
      .all<{ title: string; event_time: string }>(),
  ]);

  const habits: TimedHabit[] = (habitRows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    time: row.action_time,
    twoMin: row.two_min,
  }));

  const events: TimedEvent[] = (eventRows.results ?? []).map((row) => ({
    title: row.title,
    time: row.event_time,
    durationMin: ASSUMED_EVENT_MINUTES,
  }));

  return c.json({ date, suggestions: findClashes(habits, events) });
});

// GET /api/daily/shutdown — ritual Tutup Hari untuk satu tanggal
daily.get('/shutdown', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? jakartaToday();

  const row = await c.env.DB.prepare(
    'SELECT journal, mood, top_priorities, completed_at FROM daily_shutdown WHERE user_id = ?1 AND shutdown_date = ?2'
  )
    .bind(user.sub, date)
    .first<{ journal: string | null; mood: number | null; top_priorities: string | null; completed_at: number }>();

  return c.json({
    date,
    done: row !== null,
    journal: row?.journal ?? null,
    mood: row?.mood ?? null,
    // Disimpan sebagai JSON; kolom rusak diperlakukan sebagai kosong daripada
    // menjatuhkan seluruh permintaan.
    topPriorities: (() => {
      if (!row?.top_priorities) return [];
      try {
        const parsed = JSON.parse(row.top_priorities);
        return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
      } catch {
        return [];
      }
    })(),
    completedAt: row?.completed_at ?? null,
  });
});

// POST /api/daily/shutdown — simpan atau perbarui ritual hari itu
daily.post('/shutdown', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ date?: string; journal?: string; mood?: number; topPriorities?: string[] }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'invalid_request' }, 400);

  const date = body.date ?? jakartaToday();

  if (body.mood !== undefined && (typeof body.mood !== 'number' || body.mood < 1 || body.mood > 5)) {
    return c.json({ error: 'mood harus antara 1 sampai 5' }, 400);
  }

  const priorities = Array.isArray(body.topPriorities)
    ? body.topPriorities.filter((p) => typeof p === 'string' && p.trim()).slice(0, 3)
    : [];

  // Satu baris per hari: menutup hari dua kali memperbarui catatan yang sama,
  // bukan menumpuk baris yang saling bertentangan.
  await c.env.DB.prepare(
    `INSERT INTO daily_shutdown (user_id, shutdown_date, journal, mood, top_priorities, completed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT (user_id, shutdown_date) DO UPDATE SET
       journal = excluded.journal,
       mood = excluded.mood,
       top_priorities = excluded.top_priorities,
       completed_at = excluded.completed_at`
  )
    .bind(user.sub, date, body.journal?.trim() || null, body.mood ?? null, JSON.stringify(priorities))
    .run();

  return c.json({ date, done: true, topPriorities: priorities });
});

// GET /api/daily/patterns — hubungan antar modul, atau kejujuran soal data kurang
daily.get('/patterns', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const since = shiftDate(today, -Number(c.req.query('days') ?? 60));

  const [habitDays, health, spend] = await Promise.all([
    // Tingkat penyelesaian per hari: berapa kebiasaan selesai dibagi jumlah
    // kebiasaan yang dimiliki sekarang.
    c.env.DB.prepare(
      `SELECT completed_date AS date, COUNT(*) AS done FROM habit_completions
       WHERE user_id = ?1 AND completed_date >= ?2
       GROUP BY completed_date`
    )
      .bind(user.sub, since)
      .all<{ date: string; done: number }>(),
    c.env.DB.prepare(
      `SELECT metric_date, metric, value FROM health_metrics
       WHERE user_id = ?1 AND metric_date >= ?2`
    )
      .bind(user.sub, since)
      .all<{ metric_date: string; metric: string; value: number }>(),
    c.env.DB.prepare(
      `SELECT entry_date AS date, SUM(amount_idr) AS total FROM budget_entries
       WHERE user_id = ?1 AND type = 'expense' AND entry_date >= ?2
       GROUP BY entry_date`
    )
      .bind(user.sub, since)
      .all<{ date: string; total: number }>(),
  ]);

  const totalHabits = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM habits WHERE user_id = ?1'
  )
    .bind(user.sub)
    .first<{ n: number }>();

  const habitCount = totalHabits?.n ?? 0;
  if (habitCount === 0) {
    return c.json({
      patterns: [],
      daysAnalysed: 0,
      skipped: [{ id: 'habits', reason: 'Belum ada kebiasaan yang dilacak.' }],
    });
  }

  const byDate = new Map<string, DayRecord>();
  // Hari nol kebiasaan tetap harus dihitung nol, bukan dianggap tidak ada.
  // Kalau tidak, satu-satunya hari yang pernah dianalisis adalah hari yang ada
  // penyelesaiannya — persis hari-hari baik — dan tiap pola jadi timpang ke
  // arah yang menyenangkan. Sebuah hari dianggap terjadi kalau ada jejak apa
  // pun darinya: metrik kesehatan, pengeluaran, atau penyelesaian kebiasaan.
  const ensure = (date: string): DayRecord => {
    if (!byDate.has(date)) byDate.set(date, { date, completionRate: 0 });
    return byDate.get(date)!;
  };

  for (const row of health.results ?? []) {
    const day = ensure(row.metric_date);
    if (row.metric === 'sleep_minutes') day.sleepMinutes = row.value;
    if (row.metric === 'steps') day.steps = row.value;
  }
  for (const row of spend.results ?? []) {
    ensure(row.date).spend = row.total;
  }
  for (const row of habitDays.results ?? []) {
    ensure(row.date).completionRate = Math.min(1, row.done / habitCount);
  }

  return c.json(findPatterns([...byDate.values()]));
});

export default daily;
