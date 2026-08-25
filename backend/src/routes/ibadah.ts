/**
 * Zakat, jadwal salat, dan puasa sunnah.
 *
 * Satu rute untuk tiga hal yang berbagi sifat sama: aturannya tetap, angkanya
 * datang dari data yang sudah ada di aplikasi, dan tidak satu pun memerlukan
 * AI. Zakat dihitung dari harta yang sudah dicatat di Uang; jadwal salat dari
 * koordinat yang sudah disimpan untuk cuaca kebun; puasa sunnah dari kalender
 * Hijriah yang sudah dipakai layar Kalender.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import {
  hitungZakatMaal, hitungZakatPenghasilan, statusHaul,
  NISAB_GRAM_EMAS, NISAB_GRAM_PERAK, KADAR_ZAKAT, type JenisNisab,
} from '../lib/zakat';
import { hitungJadwalSalat, salatBerikutnya, type AsrMethod, type PrayerMethod, type PrayerName } from '../lib/prayer';
import { puasaMendatang, ringkasPuasa, puasaPada, LABEL_PUASA } from '../lib/fasting';

const ibadah = new Hono<AuthContext>();
ibadah.use('/*', requireAuth);

/** WIB. Aplikasi ini memang untuk pemakai di Indonesia. */
const TIMEZONE = 7;

// ─────────────────────────────── ZAKAT ───────────────────────────────

interface ZakatRow {
  metal_price_per_gram: number;
  nisab_type: string;
  haul_start_date: string | null;
  income_deduction: number;
  price_updated_at: string | null;
}

async function bacaPengaturanZakat(
  db: AuthContext['Bindings']['DB'],
  userId: string
): Promise<ZakatRow> {
  const row = await db.prepare(
    `SELECT metal_price_per_gram, nisab_type, haul_start_date, income_deduction, price_updated_at
       FROM zakat_settings WHERE user_id = ?1`
  ).bind(userId).first<ZakatRow>();

  return row ?? {
    metal_price_per_gram: 0,
    nisab_type: 'emas',
    haul_start_date: null,
    income_deduction: 0,
    price_updated_at: null,
  };
}

// GET /api/ibadah/zakat — hitungan zakat dari harta yang sudah tercatat
ibadah.get('/zakat', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const pengaturan = await bacaPengaturanZakat(c.env.DB, user.sub);

  const [snapshot, saldo, penghasilan, dibayar] = await Promise.all([
    // Aset dan kewajiban terakhir yang sudah dihitung modul Kekayaan Bersih.
    c.env.DB.prepare(
      'SELECT assets, liabilities, month FROM net_worth_snapshots WHERE user_id = ?1 ORDER BY month DESC LIMIT 1'
    ).bind(user.sub).first<{ assets: number; liabilities: number; month: string }>(),
    c.env.DB.prepare(
      'SELECT COALESCE(SUM(balance), 0) AS total FROM bank_accounts WHERE user_id = ?1'
    ).bind(user.sub).first<{ total: number }>(),
    // Rata-rata pemasukan tiga bulan terakhir, sebagai usulan untuk zakat
    // penghasilan. Satu bulan terlalu goyah kalau ada bonus atau THR.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM budget_entries
        WHERE user_id = ?1 AND type = 'income' AND entry_date >= ?2 AND entry_date <= ?3`
    ).bind(user.sub, new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86400000).toISOString().slice(0, 10), today)
      .first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT id, kind, amount_idr, paid_date, recipient, note FROM zakat_payments
        WHERE user_id = ?1 ORDER BY paid_date DESC LIMIT 24`
    ).bind(user.sub).all<{
      id: string; kind: string; amount_idr: number; paid_date: string;
      recipient: string | null; note: string | null;
    }>(),
  ]);

  const jenis: JenisNisab = pengaturan.nisab_type === 'perak' ? 'perak' : 'emas';
  const harga = pengaturan.metal_price_per_gram;

  // Kas diambil dari saldo rekening; sisa aset dari snapshot kekayaan bersih
  // dikurangi kas supaya tidak dihitung dua kali.
  const kas = saldo?.total ?? 0;
  const asetLain = Math.max(0, (snapshot?.assets ?? 0) - kas);

  const maal = hitungZakatMaal(
    { kas, logamMulia: 0, investasi: asetLain, utangJatuhTempo: snapshot?.liabilities ?? 0 },
    harga,
    jenis
  );

  const rataPenghasilan = Math.round((penghasilan?.total ?? 0) / 3);
  const gaji = hitungZakatPenghasilan(rataPenghasilan, harga, pengaturan.income_deduction, jenis);

  const haul = pengaturan.haul_start_date
    ? statusHaul(pengaturan.haul_start_date, today)
    : null;

  return c.json({
    pengaturan: {
      hargaPerGram: harga,
      jenisNisab: jenis,
      gramNisab: jenis === 'perak' ? NISAB_GRAM_PERAK : NISAB_GRAM_EMAS,
      kadar: KADAR_ZAKAT,
      haulStartDate: pengaturan.haul_start_date,
      pengurangPenghasilan: pengaturan.income_deduction,
      hargaDiperbaruiPada: pengaturan.price_updated_at,
    },
    // Sumber tiap angka disebutkan supaya pengguna bisa memeriksanya, bukan
    // sekadar mempercayainya.
    sumber: {
      kas: 'Saldo seluruh rekening',
      asetLain: snapshot ? `Aset di Kekayaan Bersih ${snapshot.month} dikurangi saldo rekening` : null,
      utang: snapshot ? `Kewajiban di Kekayaan Bersih ${snapshot.month}` : null,
      penghasilan: 'Rata-rata pemasukan 90 hari terakhir',
    },
    maal,
    penghasilan: { ...gaji, rataBulanan: rataPenghasilan },
    haul,
    riwayat: dibayar.results ?? [],
    // Harga logam tidak bisa diambil tanpa kunci API, jadi kalau belum diisi
    // itu dikatakan apa adanya — bukan dihitung dengan angka nol diam-diam.
    perluHargaLogam: harga <= 0,
  });
});

// PUT /api/ibadah/zakat — simpan pengaturan zakat
ibadah.put('/zakat', async (c) => {
  const user = c.get('user');
  type Body = {
    hargaPerGram?: number; jenisNisab?: string;
    haulStartDate?: string | null; pengurangPenghasilan?: number;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const lama = await bacaPengaturanZakat(c.env.DB, user.sub);
  const harga = typeof body.hargaPerGram === 'number' && body.hargaPerGram >= 0
    ? Math.round(body.hargaPerGram)
    : lama.metal_price_per_gram;

  const jenis = body.jenisNisab === 'perak' || body.jenisNisab === 'emas'
    ? body.jenisNisab
    : lama.nisab_type;

  const haul = body.haulStartDate === null
    ? null
    : typeof body.haulStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.haulStartDate)
      ? body.haulStartDate
      : lama.haul_start_date;

  const pengurang = typeof body.pengurangPenghasilan === 'number' && body.pengurangPenghasilan >= 0
    ? Math.round(body.pengurangPenghasilan)
    : lama.income_deduction;

  // Tanggal harga hanya diperbarui saat harganya benar-benar berubah, supaya
  // "diperbarui hari ini" tidak berbohong tentang angka yang tidak disentuh.
  const tanggalHarga = harga !== lama.metal_price_per_gram
    ? jakartaToday()
    : lama.price_updated_at;

  await c.env.DB.prepare(
    `INSERT INTO zakat_settings
       (user_id, metal_price_per_gram, nisab_type, haul_start_date, income_deduction, price_updated_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       metal_price_per_gram = ?2, nisab_type = ?3, haul_start_date = ?4,
       income_deduction = ?5, price_updated_at = ?6, updated_at = unixepoch()`
  ).bind(user.sub, harga, jenis, haul, pengurang, tanggalHarga).run();

  return c.json({ ok: true });
});

// POST /api/ibadah/zakat/bayar — catat zakat yang sudah ditunaikan
ibadah.post('/zakat/bayar', async (c) => {
  const user = c.get('user');
  type Body = { kind?: string; amount?: number; date?: string; recipient?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const amount = typeof body.amount === 'number' && body.amount > 0 ? Math.round(body.amount) : 0;
  if (amount === 0) return c.json({ error: 'jumlah zakat harus lebih dari nol' }, 400);

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO zakat_payments (id, user_id, kind, amount_idr, paid_date, recipient, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    id, user.sub,
    body.kind === 'penghasilan' ? 'penghasilan' : 'maal',
    amount,
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : jakartaToday(),
    body.recipient?.trim().slice(0, 120) || null,
    body.note?.trim().slice(0, 300) || null
  ).run();

  return c.json({ id, ok: true }, 201);
});

// DELETE /api/ibadah/zakat/bayar/:id
ibadah.delete('/zakat/bayar/:id', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM zakat_payments WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'catatan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ──────────────────────── SALAT DAN PUASA ────────────────────────

// GET /api/ibadah/salat — jadwal hari ini beserta waktu berikutnya
ibadah.get('/salat', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const date = c.req.query('date');
  const tanggal = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;

  const [lokasi, setelan] = await Promise.all([
    // Koordinat rumah sudah tersimpan untuk cuaca kebun. Menyimpan koordinat
    // kedua berarti dua sumber yang bisa berbeda tanpa ada layar yang bisa
    // menjelaskan mana yang benar.
    c.env.DB.prepare(
      'SELECT latitude, longitude, label FROM garden_location WHERE user_id = ?1'
    ).bind(user.sub).first<{ latitude: number; longitude: number; label: string | null }>(),
    c.env.DB.prepare(
      'SELECT method, asr_method, adjust_json FROM prayer_settings WHERE user_id = ?1'
    ).bind(user.sub).first<{ method: string; asr_method: string; adjust_json: string }>(),
  ]);

  if (!lokasi) {
    return c.json({
      perluLokasi: true,
      message: 'Jadwal salat butuh koordinat rumahmu. Isi lokasi di layar Kebun — koordinat yang sama dipakai keduanya.',
    });
  }

  let adjust: Partial<Record<PrayerName, number>> = {};
  try {
    const parsed = JSON.parse(setelan?.adjust_json ?? '{}');
    if (parsed && typeof parsed === 'object') adjust = parsed as Partial<Record<PrayerName, number>>;
  } catch {
    adjust = {};
  }

  const method: PrayerMethod = setelan?.method === 'mwl' ? 'mwl' : 'kemenag';
  const asrMethod: AsrMethod = setelan?.asr_method === 'hanafi' ? 'hanafi' : 'syafii';

  const times = hitungJadwalSalat({
    date: tanggal,
    latitude: lokasi.latitude,
    longitude: lokasi.longitude,
    timezone: TIMEZONE,
    method,
    asrMethod,
    adjust,
  });

  // Jam sekarang menurut WIB, bukan menurut jam server.
  const sekarang = new Date(Date.now() + TIMEZONE * 3600000).toISOString().slice(11, 16);

  return c.json({
    date: tanggal,
    times,
    berikutnya: tanggal === today ? salatBerikutnya(times, sekarang) : null,
    lokasi: { label: lokasi.label, latitude: lokasi.latitude, longitude: lokasi.longitude },
    metode: { method, asrMethod, adjust },
    // Disebutkan apa adanya: jadwal resmi menambahkan menit ihtiyat yang
    // besarnya berbeda antar daerah, jadi selisih satu-dua menit itu wajar
    // dan bisa disamakan lewat penyesuaian.
    catatan: 'Dihitung dari posisi matahari. Bisa berbeda 1–2 menit dari jadwal masjid setempat — sesuaikan lewat pengaturan.',
  });
});

// PUT /api/ibadah/salat — metode dan penyesuaian menit
ibadah.put('/salat', async (c) => {
  const user = c.get('user');
  type Body = { method?: string; asrMethod?: string; adjust?: Record<string, number> };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const method = body.method === 'mwl' ? 'mwl' : 'kemenag';
  const asrMethod = body.asrMethod === 'hanafi' ? 'hanafi' : 'syafii';

  // Penyesuaian dibatasi ±30 menit: lebih dari itu bukan menyamakan dengan
  // masjid setempat, melainkan mengarang jadwal.
  const bersih: Record<string, number> = {};
  const NAMA: PrayerName[] = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  for (const nama of NAMA) {
    const v = body.adjust?.[nama];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
      bersih[nama] = Math.max(-30, Math.min(30, Math.round(v)));
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO prayer_settings (user_id, method, asr_method, adjust_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       method = ?2, asr_method = ?3, adjust_json = ?4, updated_at = unixepoch()`
  ).bind(user.sub, method, asrMethod, JSON.stringify(bersih)).run();

  return c.json({ ok: true });
});

// GET /api/ibadah/puasa — hari puasa sunnah mendatang dan catatan sendiri
ibadah.get('/puasa', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const days = Number(c.req.query('days') ?? 30);

  const log = await c.env.DB.prepare(
    `SELECT fast_date, kind, note FROM fasting_log
      WHERE user_id = ?1 ORDER BY fast_date DESC LIMIT 200`
  ).bind(user.sub).all<{ fast_date: string; kind: string; note: string | null }>();

  const rows = log.results ?? [];
  const sudah = new Set(rows.map((r) => r.fast_date));

  return c.json({
    today: {
      date: today,
      kinds: puasaPada(today).map((k) => ({ kind: k, label: LABEL_PUASA[k] })),
      sudahDicatat: sudah.has(today),
    },
    mendatang: puasaMendatang(today, Number.isFinite(days) ? days : 30).map((h) => ({
      ...h,
      labels: h.kinds.map((k) => LABEL_PUASA[k]),
      sudahDicatat: sudah.has(h.date),
    })),
    ringkasan: ringkasPuasa(rows.map((r) => ({ date: r.fast_date, kind: r.kind })), today),
    riwayat: rows.slice(0, 30),
  });
});

// POST /api/ibadah/puasa — catat puasa satu hari
ibadah.post('/puasa', async (c) => {
  const user = c.get('user');
  type Body = { date?: string; kind?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : jakartaToday();

  const kind = typeof body.kind === 'string' && LABEL_PUASA[body.kind as keyof typeof LABEL_PUASA]
    ? body.kind
    : (puasaPada(date)[0] ?? 'lainnya');

  // Tanggal jadi bagian kunci utama, jadi menandai hari yang sama dua kali
  // memperbarui catatannya alih-alih membuat baris kedua.
  await c.env.DB.prepare(
    `INSERT INTO fasting_log (user_id, fast_date, kind, note) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, fast_date) DO UPDATE SET kind = ?3, note = ?4`
  ).bind(user.sub, date, kind, body.note?.trim().slice(0, 200) || null).run();

  return c.json({ ok: true, date, kind });
});

// DELETE /api/ibadah/puasa/:date — batalkan catatan puasa satu hari
ibadah.delete('/puasa/:date', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM fasting_log WHERE user_id = ?1 AND fast_date = ?2'
  ).bind(user.sub, c.req.param('date')).run();

  if (res.meta.changes === 0) return c.json({ error: 'catatan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

export default ibadah;
