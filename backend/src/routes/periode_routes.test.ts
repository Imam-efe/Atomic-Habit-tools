/**
 * Uji periode laporan yang bisa diatur, dari sisi rute.
 *
 * Uji unit di lib/finance_periode.test.ts sudah membuktikan batas periodenya
 * benar. Yang dibuktikan DI SINI adalah bahwa setiap rute benar-benar
 * memakainya — dan itu perkara lain sama sekali.
 *
 * Ada delapan tempat di backend yang dulu menghitung "bulan ini" sendiri. Satu
 * saja yang tidak ikut akan menampilkan angka BERBEDA untuk hal yang sama di
 * layar yang berbeda: dashboard bilang belanja 3 juta, menu Uang bilang 1,8
 * juta, dan keduanya terlihat masuk akal. Tidak ada galat, tidak ada yang
 * kelihatan rusak. Karena itu tiap rute diuji sendiri, bukan diwakili satu.
 *
 * Kasus ujinya memakai cut-off tanggal 25 — siklus gajian yang paling umum di
 * Indonesia, dan yang jadi alasan fitur ini ada.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import budgetRoute from './budget';
import financeReport from './finance_report';
import dashboardRoute from './dashboard';
import dailyRoute from './daily';
import monthlyReview from './monthly_review';
import { signJWT } from '../lib/jwt';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import { saveSetting } from '../lib/settings';
import { periodeUntuk, sisaHariPeriode } from '../lib/finance_periode';
import { jakartaToday } from '../lib/validate';
import { shiftDate, daysBetween } from '../lib/daily';

const JWT_SECRET = 'rahasia-untuk-test';

let db: FakeD1;
let app: Hono<never>;
let token: string;

function env() {
  return {
    DB: db,
    JWT_SECRET,
    AI: { run: async () => { throw new Error('AI tidak dipakai di test ini'); } },
  } as unknown as Record<string, unknown>;
}

function req(path: string, init: RequestInit = {}) {
  return app.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    }),
    env()
  );
}

beforeEach(async () => {
  db = createTestDb();
  seedUser(db, 'user-1');
  const now = Math.floor(Date.now() / 1000);
  token = await signJWT({ sub: 'user-1', name: 'P', role: 'user', iat: now, exp: now + 3600 }, JWT_SECRET);

  app = new Hono() as Hono<never>;
  app.route('/api/budget', budgetRoute as never);
  app.route('/api/finance-report', financeReport as never);
  app.route('/api/dashboard', dashboardRoute as never);
  app.route('/api/daily', dailyRoute as never);
  app.route('/api/monthly-review', monthlyReview as never);
});

afterEach(() => db.__close());

const D = () => db as never;

async function setCutOff(hari: number) {
  const ok = await saveSetting(D(), 'user-1', 'money.period_start_day', hari);
  expect(ok, `cut-off ${hari} ditolak registry`).toBe(true);
}

async function catat(tanggal: string, jumlah: number, type = 'expense', kategori = 'Makanan & Minuman') {
  await db.prepare(
    `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, entry_date, created_at)
     VALUES (?1, 'user-1', ?2, ?3, ?4, ?5, 0)`
  ).bind(`e-${tanggal}-${jumlah}-${type}`, type, jumlah, kategori, tanggal).run();
}

/**
 * Tiga transaksi yang memisahkan kedua tafsir dengan tajam.
 *
 * Periode 2026-10 dengan cut-off 25 berarti 25 Sep–24 Okt. Jadi:
 *   - 26 Sep MASUK periode itu, padahal bulan kalendernya September
 *   - 10 Okt MASUK di kedua tafsir
 *   - 28 Okt DI LUAR periode itu, padahal bulan kalendernya Oktober
 *
 * Bulan kalender Oktober = 10 Okt + 28 Okt = 700rb.
 * Periode 25 Sep–24 Okt  = 26 Sep + 10 Okt = 400rb.
 * Angkanya tidak mungkin tertukar tanpa terdeteksi.
 */
async function tigaTransaksi() {
  await catat('2026-09-26', 100_000);
  await catat('2026-10-10', 300_000);
  await catat('2026-10-28', 400_000);
}

describe('GET /api/budget', () => {
  it('bulan kalender saat cut-off masih tanggal 1', async () => {
    await tigaTransaksi();
    const r = await (await req('/api/budget?month=2026-10')).json() as {
      summary: { expense: number };
    };
    expect(r.summary.expense).toBe(700_000);
  });

  it('mengikuti periode gajian saat cut-off tanggal 25', async () => {
    await tigaTransaksi();
    await setCutOff(25);

    const r = await (await req('/api/budget?month=2026-10')).json() as {
      summary: { expense: number };
      entries: Array<{ date: string }>;
    };
    expect(r.summary.expense).toBe(400_000);
    expect(r.entries.map((e) => e.date).sort()).toEqual(['2026-09-26', '2026-10-10']);
  });

  it('rentang eksplisit dari layar tetap menang atas pengaturan', async () => {
    await tigaTransaksi();
    await setCutOff(25);

    // Pemilih rentang di layar ("30 hari terakhir") harus tetap berarti apa
    // yang dikatakannya, bukan diam-diam dijepit ke periode laporan.
    const r = await (await req('/api/budget?from=2026-10-01&to=2026-10-31')).json() as {
      summary: { expense: number };
    };
    expect(r.summary.expense).toBe(700_000);
  });
});

describe('GET /api/budget/limits', () => {
  it('menghitung belanja pada rentang periode, bukan bulan kalender', async () => {
    await tigaTransaksi();
    await setCutOff(25);
    await req('/api/budget/limits', {
      method: 'POST',
      body: JSON.stringify({ category: 'Makanan & Minuman', limit: 1_000_000, month: '2026-10' }),
    });

    const hasil = await (await req('/api/budget/limits?month=2026-10')).json() as Array<{
      category: string; limit: number; spent: number; remaining: number;
    }>;
    const baris = hasil.find((l) => l.category === 'Makanan & Minuman')!;
    expect(baris.spent).toBe(400_000);
    expect(baris.remaining).toBe(600_000);
  });

  it('limit yang disimpan tanpa label masuk ke periode yang sedang berjalan', async () => {
    // Kalau POST memakai bulan kalender sementara GET memakai periode, limitnya
    // tersimpan di label yang tidak pernah dibaca layar — tersimpan, tapi tidak
    // pernah terlihat.
    await setCutOff(25);
    await req('/api/budget/limits', {
      method: 'POST',
      body: JSON.stringify({ category: 'Makanan & Minuman', limit: 750_000 }),
    });

    const row = await db.prepare('SELECT month FROM budget_limits WHERE user_id = ?1')
      .bind('user-1').first<{ month: string }>();
    const hasil = await (await req('/api/budget/limits')).json() as Array<{
      category: string; limit: number;
    }>;
    expect(hasil.find((l) => l.category === 'Makanan & Minuman')!.limit).toBe(750_000);
    expect(row!.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('GET /api/finance-report', () => {
  it('laba rugi mengikuti periode', async () => {
    await tigaTransaksi();
    await setCutOff(25);

    const r = await (await req('/api/finance-report?month=2026-10')).json() as {
      pnl: { expense: number };
    };
    expect(r.pnl.expense).toBe(400_000);
  });
});

describe('GET /api/finance-report/forecast', () => {
  it('menghitung hari terlampaui dari awal periode, bukan tanggal dalam bulan', async () => {
    await setCutOff(25);
    await catat('2026-09-26', 200_000);

    // Periode 2026-10 sudah lewat seluruhnya relatif terhadap tanggal uji ini,
    // jadi hari terlampaui harus sama dengan panjang periodenya (30 hari:
    // 25 Sep sampai 24 Okt), bukan 31 hari bulan kalender Oktober.
    const r = await (await req('/api/finance-report/forecast?month=2026-10')).json() as {
      days_elapsed: number; days_remaining: number;
    };
    expect(r.days_elapsed + r.days_remaining).toBe(30);
  });

  it('panjang periode bulan kalender tetap 31 hari untuk Oktober', async () => {
    const r = await (await req('/api/finance-report/forecast?month=2026-10')).json() as {
      days_elapsed: number; days_remaining: number;
    };
    expect(r.days_elapsed + r.days_remaining).toBe(31);
  });
});

describe('GET /api/dashboard', () => {
  it('ringkasan uang dimulai tepat di awal periode', async () => {
    // Dulu dashboard menghitung `${month}-01` sendiri. Kalau ia tidak ikut,
    // dua layar menampilkan angka berbeda untuk hal yang sama.
    //
    // Batas periodenya dihitung di sini dari `jakartaToday()` yang sama, bukan
    // ditulis sebagai tanggal tetap: rutenya membaca hari ini sendiri dan tidak
    // bisa disuntik, jadi uji bertanggal tetap akan lulus bulan ini lalu gagal
    // bulan depan tanpa ada yang berubah di kodenya.
    await setCutOff(25);
    const periode = periodeUntuk(jakartaToday(), 25);

    await catat(periode.mulai, 100_000);
    await catat(shiftDate(periode.mulai, -1), 900_000);

    const r = await (await req('/api/dashboard')).json() as { budget: { expense: number } };
    // Sehari sebelum periode dimulai harus TIDAK terhitung. Kalau rutenya
    // masih memakai tanggal 1, 900rb itu ikut masuk.
    expect(r.budget.expense).toBe(100_000);
  });
});

describe('GET /api/daily/safe-to-spend', () => {
  it('sisa hari dihitung sampai akhir periode, bukan akhir bulan', async () => {
    await setCutOff(25);
    const today = jakartaToday();
    const periode = periodeUntuk(today, 25);

    const r = await (await req('/api/daily/safe-to-spend')).json() as { daysLeft: number };
    expect(r.daysLeft).toBe(sisaHariPeriode(today, periode));
  });

  it('sisa hari berbeda dari bulan kalender pada cut-off 25', async () => {
    // Menjaga uji di atas tetap bergigi: kalau kedua tafsir kebetulan
    // menghasilkan angka yang sama pada tanggal ujiannya, uji itu tidak
    // membuktikan apa pun. Di sini dibuktikan keduanya memang berbeda.
    const today = jakartaToday();
    const dariPeriode = sisaHariPeriode(today, periodeUntuk(today, 25));
    const dariKalender = sisaHariPeriode(today, periodeUntuk(today, 1));
    expect(dariPeriode).not.toBe(dariKalender);
  });
});

describe('GET /api/monthly-review', () => {
  it('rekap mengikuti periode, bukan bulan kalender', async () => {
    await tigaTransaksi();
    await setCutOff(25);

    const r = await (await req('/api/monthly-review?month=2026-10')).json() as {
      stats: { totalExpense: number; daysElapsed: number };
    };
    expect(r.stats.totalExpense).toBe(400_000);
  });

  it('hari terlampaui dihitung dari awal periode berjalan', async () => {
    // Nilai harapannya diturunkan dari lib yang sama, bukan ditulis tetap:
    // rutenya membaca `jakartaToday()` sendiri, jadi angka tetap apa pun akan
    // benar hari ini dan salah bulan depan. (Percobaan pertama uji ini memang
    // memakai angka tetap 30 dan langsung gagal — dengan cut-off 25, label
    // "2026-10" justru periode yang SEDANG berjalan, bukan yang sudah lewat.)
    await setCutOff(25);
    const today = jakartaToday();
    const periode = periodeUntuk(today, 25);

    const r = await (await req(`/api/monthly-review?month=${periode.label}`)).json() as {
      stats: { daysElapsed: number };
    };
    expect(r.stats.daysElapsed).toBe(daysBetween(periode.mulai, today) + 1);
  });

  it('hari terlampaui berbeda dari hitungan tanggal-dalam-bulan', async () => {
    // Menjaga uji di atas tetap bergigi: kalau kedua tafsir kebetulan
    // menghasilkan angka sama pada tanggal ujiannya, uji itu tidak membuktikan
    // apa pun.
    const today = jakartaToday();
    const periode = periodeUntuk(today, 25);
    expect(daysBetween(periode.mulai, today) + 1).not.toBe(Number(today.slice(8, 10)));
  });

  it('bulan kalender tetap 31 hari saat cut-off masih tanggal 1', async () => {
    const r = await (await req('/api/monthly-review?month=2026-10')).json() as {
      stats: { daysElapsed: number };
    };
    expect(r.stats.daysElapsed).toBe(31);
  });
});

describe('pengaturan ditolak dengan benar', () => {
  it('menolak nilai di luar 1-28', async () => {
    expect(await saveSetting(D(), 'user-1', 'money.period_start_day', 31)).toBe(false);
    expect(await saveSetting(D(), 'user-1', 'money.period_start_day', 0)).toBe(false);
  });

  it('menolak yang bukan angka', async () => {
    expect(await saveSetting(D(), 'user-1', 'money.period_start_day', 'gajian')).toBe(false);
  });

  it('menerima 28 sebagai batas atas', async () => {
    expect(await saveSetting(D(), 'user-1', 'money.period_start_day', 28)).toBe(true);
  });

  it('horizon proyeksi dan peringatan anggaran punya batasnya sendiri', async () => {
    expect(await saveSetting(D(), 'user-1', 'money.projection_days', 400)).toBe(false);
    expect(await saveSetting(D(), 'user-1', 'money.projection_days', 90)).toBe(true);
    expect(await saveSetting(D(), 'user-1', 'money.budget_warn_percent', 30)).toBe(false);
    expect(await saveSetting(D(), 'user-1', 'money.budget_warn_percent', 75)).toBe(true);
  });

  it('rentang bawaan hanya menerima pilihan yang ada', async () => {
    expect(await saveSetting(D(), 'user-1', 'money.default_range', 'periode')).toBe(true);
    expect(await saveSetting(D(), 'user-1', 'money.default_range', 'seminggu')).toBe(false);
  });
});
