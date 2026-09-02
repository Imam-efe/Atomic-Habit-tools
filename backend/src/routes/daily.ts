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
import { loadSettings, num, bool } from '../lib/settings';
import { computeCareState, lastActions, resolvePlants, type PlantingRow } from './garden';
import { cariTerlantar, type Sentuhan } from '../lib/garden_neglect';
import { jadwalPengguna } from './ternak_care';
import { cekKepadatan, type Penghuni } from '../lib/ternak_kepadatan';
import { ANIMAL_BY_ID } from '../data/animals';

/**
 * Ringkasan tugas kebun hari ini, untuk Pagi Ini dan Tutup Hari.
 *
 * Kebun adalah modul dengan tugas harian terbanyak di seluruh aplikasi, dan
 * sampai sekarang ia satu-satunya yang tidak pernah muncul di ringkasan harian
 * — jadi tanaman yang telat siram hanya ketahuan kalau pengguna kebetulan
 * membuka tabnya.
 *
 * Ditaruh di berkas rute, bukan di lib/daily.ts: hitungan jatuh temponya
 * berasal dari `computeCareState` yang tinggal di routes/garden.ts, dan sebuah
 * pustaka yang mengimpor rute akan membalik lapisan modul ini.
 */
export interface GardenToday {
  perluSiram: number;
  perluPupuk: number;
  siapPanen: number;
  terlantar: number;
  /** Beberapa nama untuk ditampilkan; sengaja dibatasi agar teks tidak meluber. */
  contoh: string[];
}

/** Di atas ini daftar nama lebih panjang daripada ringkasannya sendiri. */
const MAKS_CONTOH = 3;

export async function getGardenToday(
  db: D1Database,
  userId: string,
  today: string
): Promise<GardenToday> {
  const [rows, lastMap] = await Promise.all([
    db.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
              planted_date, expected_harvest_date, status, note
         FROM garden_plantings
        WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
    ).bind(userId).all<PlantingRow>(),
    lastActions(db, userId),
  ]);

  const plantings = rows.results ?? [];
  const plantMap = await resolvePlants(
    db,
    [...new Set(plantings.map((p) => p.plant_id).filter((id): id is string => !!id))]
  );

  let perluSiram = 0;
  let perluPupuk = 0;
  let siapPanen = 0;
  const contoh: string[] = [];
  const sentuhan: Sentuhan[] = [];

  for (const p of plantings) {
    const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
    const last = lastMap.get(p.id) ?? {};
    const care = computeCareState(p, plant, last, today);
    const nama = p.nickname ?? plant?.name ?? p.custom_name ?? 'Tanaman';

    if (care.waterOverdueDays > 0) perluSiram++;
    if (care.fertilizeOverdueDays > 0) perluPupuk++;
    if (care.harvestReady) siapPanen++;

    if (
      contoh.length < MAKS_CONTOH &&
      (care.waterOverdueDays > 0 || care.fertilizeOverdueDays > 0 || care.harvestReady)
    ) {
      contoh.push(nama);
    }

    // Sentuhan terakhir apa pun jenisnya — bukan hanya siram — supaya tanaman
    // yang cuma dipanen sebulan sekali tidak salah dianggap terlantar.
    const tanggal = [last.siram, last.pupuk, last.panen].filter(Boolean) as string[];
    sentuhan.push({
      plantingId: p.id,
      nama,
      lastCare: tanggal.length > 0 ? tanggal.sort().at(-1)! : null,
      plantedDate: p.planted_date,
    });
  }

  return {
    perluSiram,
    perluPupuk,
    siapPanen,
    terlantar: cariTerlantar(sentuhan, today).length,
    contoh,
  };
}

export interface TernakToday {
  tugasJatuhTempo: number;
  penting: number;
  kandangSesak: number;
  /** Beberapa nama untuk ditampilkan; sengaja dibatasi agar teks tidak meluber. */
  contoh: string[];
}

const MAKS_CONTOH_TERNAK = 3;

/**
 * Ringkasan ternak untuk Pagi Ini dan Tutup Hari.
 *
 * Memanggil jadwalPengguna, bukan menghitung ulang sendiri: dua hitungan
 * untuk pertanyaan yang sama pasti menyimpang, dan ringkasan yang tidak cocok
 * dengan layarnya membuat keduanya diragukan.
 */
export async function getTernakToday(
  db: D1Database, userId: string, today: string
): Promise<TernakToday> {
  const [semua, kandangRows, hewanRows] = await Promise.all([
    jadwalPengguna(db, userId, today),
    db.prepare(
      `SELECT id, volume_liter FROM ternak_kandang
        WHERE user_id = ?1 AND status = 'aktif' AND volume_liter IS NOT NULL AND volume_liter > 0`
    ).bind(userId).all<{ id: string; volume_liter: number }>(),
    db.prepare(
      `SELECT kandang_id, animal_id, jumlah FROM ternak_hewan
        WHERE user_id = ?1 AND status = 'hidup' AND kandang_id IS NOT NULL`
    ).bind(userId).all<{ kandang_id: string; animal_id: string | null; jumlah: number }>(),
  ]);

  const jatuhTempo = semua.filter((t) => t.berikutnya <= today);
  const penting = jatuhTempo.filter((t) => t.penting).length;

  // Kepadatan dihitung sama persis dengan GET /api/ternak/kepadatan: kandang
  // tanpa volume tercatat dilewati, penghuni tanpa angka kebutuhan tidak ikut
  // menghitung — lihat cekKepadatan untuk alasannya.
  const penghuniPerKandang = new Map<string, Penghuni[]>();
  for (const h of hewanRows.results ?? []) {
    const list = penghuniPerKandang.get(h.kandang_id) ?? [];
    list.push({
      animalId: h.animal_id,
      jumlah: h.jumlah,
      literPerEkor: h.animal_id ? (ANIMAL_BY_ID.get(h.animal_id)?.literPerEkor ?? null) : null,
    });
    penghuniPerKandang.set(h.kandang_id, list);
  }

  let kandangSesak = 0;
  for (const k of kandangRows.results ?? []) {
    const nilai = cekKepadatan(k.volume_liter, penghuniPerKandang.get(k.id) ?? []);
    if (nilai?.sesak) kandangSesak++;
  }

  return {
    tugasJatuhTempo: jatuhTempo.length,
    penting,
    kandangSesak,
    contoh: jatuhTempo.slice(0, MAKS_CONTOH_TERNAK).map((t) => t.nama),
  };
}

// Agenda tidak menyimpan durasi (lihat 0015_calendar.sql). Perkiraan yang
// dipakai pengecekan bentrok datang dari pengaturan
// `calendar.default_event_minutes`, bukan angka tetap di berkas ini.

const daily = new Hono<AuthContext>();

daily.use('/*', requireAuth);

// GET /api/daily/safe-to-spend — boleh habis berapa hari ini
daily.get('/safe-to-spend', async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env.DB, user.sub);
  return c.json(
    await computeSafeToSpend(c.env.DB, user.sub, jakartaToday(), bool(settings, 'money.subtract_bills'))
  );
});

// GET /api/daily/bills — tagihan jatuh tempo dan rekening yang menutupi
daily.get('/bills', async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env.DB, user.sub);
  const override = Number(c.req.query('within'));
  return c.json(
    await getBillRadar(
      c.env.DB, user.sub, jakartaToday(),
      Number.isFinite(override) ? override : num(settings, 'money.bill_horizon_days')
    )
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
  const settings = await loadSettings(c.env.DB, user.sub);

  const [safeToSpend, billRadar, missed, expiring, kidsToday, kebun, ternak, habitRows, events] = await Promise.all([
    computeSafeToSpend(c.env.DB, user.sub, today, bool(settings, 'money.subtract_bills')),
    getBillRadar(c.env.DB, user.sub, today, num(settings, 'money.bill_horizon_days')),
    getMissedYesterday(c.env.DB, user.sub, today),
    getExpiringItems(c.env.DB, user.sub, today, num(settings, 'inventory.expiry_days')),
    getKidsFor(c.env.DB, user.sub, today),
    getGardenToday(c.env.DB, user.sub, today),
    getTernakToday(c.env.DB, user.sub, today),
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
    kebun,
    ternak,
  });
});

// POST /api/daily/rescue — usul masakan dari stok yang mau kedaluwarsa
daily.post('/rescue', async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env.DB, user.sub);
  const items = await getExpiringItems(
    c.env.DB, user.sub, jakartaToday(), num(settings, 'inventory.expiry_days')
  );

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

  const settings = await loadSettings(c.env.DB, user.sub);

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
    durationMin: num(settings, 'calendar.default_event_minutes'),
  }));

  return c.json({
    date,
    suggestions: findClashes(habits, events, {
      startMin: num(settings, 'habit.day_start') * 60,
      endMin: num(settings, 'habit.day_end') * 60,
      slotMin: num(settings, 'habit.slot_minutes'),
    }),
  });
});

// GET /api/daily/shutdown — ritual Tutup Hari untuk satu tanggal
daily.get('/shutdown', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? jakartaToday();

  // Kebun dan ternak ikut ditanyakan supaya ritual malam menutup hari dengan
  // gambaran lengkap — tanaman yang belum disiram atau hewan yang belum
  // dirawat hari ini masih sempat dikerjakan sebelum tidur, dan malam justru
  // saat paling baik menyiram di iklim panas.
  const [row, kebun, ternak] = await Promise.all([
    c.env.DB.prepare(
      'SELECT journal, mood, top_priorities, completed_at FROM daily_shutdown WHERE user_id = ?1 AND shutdown_date = ?2'
    )
      .bind(user.sub, date)
      .first<{ journal: string | null; mood: number | null; top_priorities: string | null; completed_at: number }>(),
    getGardenToday(c.env.DB, user.sub, date),
    getTernakToday(c.env.DB, user.sub, date),
  ]);

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
    kebun,
    ternak,
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
  const settings = await loadSettings(c.env.DB, user.sub);
  const today = jakartaToday();
  const daysParam = Number(c.req.query('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0
    ? Math.min(365, Math.round(daysParam))
    : 60;
  const since = shiftDate(today, -days);

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

  return c.json(
    findPatterns([...byDate.values()], {
      minDaysPerSide: num(settings, 'patterns.min_days'),
      minGapPoints: num(settings, 'patterns.min_gap'),
    })
  );
});

export default daily;
