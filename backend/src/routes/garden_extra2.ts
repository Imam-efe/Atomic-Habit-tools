/**
 * Sepuluh fitur kebun lanjutan: kompos, skor kesulitan pribadi, susulan ke
 * kalender, wishlist musim depan, tren tahunan, panen vs terbuang,
 * sterilisasi, dan tampungan air hujan.
 *
 * Berkas terpisah dari garden_extra.ts yang sudah panjang (25 bagian
 * bernomor) — supaya sepuluh fitur baru ini bisa ditinjau sebagai satu
 * kesatuan, bukan tersebar di antara fitur lama. Dipasang di prefix yang
 * sama, jadi bagi klien tetap satu API Kebun.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { PLANT_BY_ID } from '../data/plants';
import { computeBreakEven, type YearlyTotal } from '../lib/garden_economics';
import { buildKitchenReport, priceKey, type HarvestEntry } from '../lib/garden_kitchen';
import {
  estimasiSiap, ringkasBatch, HARI_KOMPOS, type MetodeKompos,
} from '../lib/garden_compost';
import { hitungSkorKesulitan } from '../lib/garden_difficulty';
import { laporanTerbuang, type ItemPanen } from '../lib/garden_waste';
import { cariPerluSanitasi, type RiwayatLokasi } from '../lib/garden_sanitation';
import { ringkasAirHujan } from '../lib/garden_rainwater';

const extra2 = new Hono<AuthContext>();
extra2.use('/*', requireAuth);

// ─────────────────────────── #1 KOMPOS ───────────────────────────

const METODE_KOMPOS = ['cepat', 'sedang', 'lambat'] as const;

// GET /api/garden/compost — batch kompos, terbaru dulu
extra2.get('/compost', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = (await c.env.DB.prepare(
    `SELECT id, name, metode, started_date, material_note, status, applied_planting_id, applied_date
       FROM garden_compost_batches WHERE user_id = ?1 ORDER BY created_at DESC`
  ).bind(user.sub).all<{
    id: string; name: string; metode: string; started_date: string; material_note: string | null;
    status: string; applied_planting_id: string | null; applied_date: string | null;
  }>()).results ?? [];

  const batches = rows.map((r) => {
    const metode = (METODE_KOMPOS.includes(r.metode as MetodeKompos) ? r.metode : 'sedang') as MetodeKompos;
    const readyDateEstimasi = estimasiSiap(r.started_date, metode);
    const status = (r.status === 'siap' || r.status === 'terpakai' ? r.status : 'proses') as 'proses' | 'siap' | 'terpakai';
    return {
      id: r.id, name: r.name, metode, startedDate: r.started_date, materialNote: r.material_note,
      readyDateEstimasi, appliedDate: r.applied_date,
      ...ringkasBatch(readyDateEstimasi, today, status),
    };
  });

  return c.json({ batches, hariMetode: HARI_KOMPOS });
});

// POST /api/garden/compost — mulai batch baru
extra2.post('/compost', async (c) => {
  const user = c.get('user');
  type Body = { name?: string; metode?: string; startedDate?: string; materialNote?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const name = body.name?.trim();
  if (!name) return c.json({ error: 'nama batch wajib diisi' }, 400);

  const metode = METODE_KOMPOS.includes(body.metode as MetodeKompos) ? body.metode! : 'sedang';
  const startedDate = body.startedDate && /^\d{4}-\d{2}-\d{2}$/.test(body.startedDate) ? body.startedDate : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_compost_batches (id, user_id, name, metode, started_date, material_note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(id, user.sub, name, metode, startedDate, body.materialNote?.trim().slice(0, 300) || null).run();

  return c.json({ id, ok: true }, 201);
});

// PATCH /api/garden/compost/:id — tandai siap
extra2.patch('/compost/:id', async (c) => {
  const user = c.get('user');
  type Body = { status?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  if (body.status !== 'siap') return c.json({ error: 'status hanya bisa diubah ke siap lewat endpoint ini' }, 400);

  const res = await c.env.DB.prepare(
    `UPDATE garden_compost_batches SET status = 'siap' WHERE id = ?1 AND user_id = ?2 AND status = 'proses'`
  ).bind(c.req.param('id'), user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'batch tidak ditemukan atau sudah bukan proses' }, 404);
  return c.json({ ok: true });
});

// POST /api/garden/compost/:id/apply — terapkan ke satu tanaman, catat sebagai pemupukan
extra2.post('/compost/:id/apply', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { plantingId?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const plantingId = body.plantingId?.trim();
  if (!plantingId) return c.json({ error: 'plantingId wajib diisi' }, 400);

  const [batch, planting] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, status FROM garden_compost_batches WHERE id = ?1 AND user_id = ?2`)
      .bind(id, user.sub).first<{ id: string; name: string; status: string }>(),
    c.env.DB.prepare('SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2')
      .bind(plantingId, user.sub).first<{ id: string }>(),
  ]);

  if (!batch) return c.json({ error: 'batch tidak ditemukan' }, 404);
  if (batch.status === 'terpakai') return c.json({ error: 'batch ini sudah pernah diterapkan' }, 400);
  if (!planting) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const today = jakartaToday();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, note)
       VALUES (?1, ?2, ?3, 'pupuk', ?4, ?5)`
    ).bind(nanoid(), user.sub, plantingId, today, `Kompos: ${batch.name}`),
    c.env.DB.prepare(
      `UPDATE garden_compost_batches
         SET status = 'terpakai', applied_planting_id = ?1, applied_date = ?2
       WHERE id = ?3 AND user_id = ?4`
    ).bind(plantingId, today, id, user.sub),
  ]);

  return c.json({ ok: true });
});

// DELETE /api/garden/compost/:id
extra2.delete('/compost/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_compost_batches WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

// ──────────────────── #2 SKOR KESULITAN PRIBADI ────────────────────

// GET /api/garden/difficulty — seberapa sering berhasil menanam tiap tanaman
extra2.get('/difficulty', async (c) => {
  const user = c.get('user');

  const rows = (await c.env.DB.prepare(
    `SELECT plant_id, status FROM garden_plantings
      WHERE user_id = ?1 AND plant_id IS NOT NULL AND status IN ('gagal', 'selesai', 'panen', 'tumbuh')`
  ).bind(user.sub).all<{ plant_id: string; status: string }>()).results ?? [];

  const skor = hitungSkorKesulitan(rows.map((r) => ({ plantId: r.plant_id, status: r.status })));

  // `skor: null` berarti riwayatnya masih terlalu tipis untuk disimpulkan
  // (di bawah MIN_PERCOBAAN). Baris seperti itu tidak dikirim sama sekali:
  // kontrak endpoint ini adalah "tanaman yang sudah punya vonis", dan
  // mengirim vonis kosong memaksa setiap pemakai menangani null sendiri —
  // yang justru terlewat dan membuat layar Catatan gagal render.
  const withCatalog = skor
    .map((s) => {
      if (s.skor === null) return null;
      const plant = PLANT_BY_ID.get(s.plantId);
      return plant
        ? { ...s, skor: s.skor, name: plant.name, emoji: plant.emoji, difficultyKatalog: plant.difficulty }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return c.json({ scores: withCatalog });
});

// ──────────────────── #3 SUSULAN TANAM KE KALENDER ────────────────────

// POST /api/garden/succession/schedule — jadikan saran semai ulang jadi tugas kalender
extra2.post('/succession/schedule', async (c) => {
  const user = c.get('user');
  type Body = { label?: string; sowDate?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const label = body.label?.trim().slice(0, 120);
  if (!label) return c.json({ error: 'label wajib diisi' }, 400);
  if (!body.sowDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.sowDate)) {
    return c.json({ error: 'sowDate harus YYYY-MM-DD' }, 400);
  }

  const id = nanoid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO calendar_events (id, user_id, title, note, kind, event_date, is_done, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'task', ?5, 0, ?6, ?6)`
  ).bind(id, user.sub, `Semai ulang: ${label}`, 'Supaya panen bersambung, dijadwalkan dari tab Rencana Kebun.', body.sowDate, now).run();

  return c.json({ id, ok: true }, 201);
});

// ──────────────────── #4 WISHLIST MUSIM DEPAN ────────────────────

// GET /api/garden/wishlist
extra2.get('/wishlist', async (c) => {
  const user = c.get('user');
  const rows = (await c.env.DB.prepare(
    'SELECT id, plant_id, custom_name, note, created_at FROM garden_wishlist WHERE user_id = ?1 ORDER BY created_at DESC'
  ).bind(user.sub).all<{ id: string; plant_id: string | null; custom_name: string | null; note: string | null; created_at: number }>()).results ?? [];

  const items = rows.map((r) => {
    const plant = r.plant_id ? PLANT_BY_ID.get(r.plant_id) : undefined;
    return {
      id: r.id,
      plantId: r.plant_id,
      name: plant?.name ?? r.custom_name ?? 'Tanaman',
      emoji: plant?.emoji ?? '🌱',
      note: r.note,
    };
  });

  return c.json({ items });
});

// POST /api/garden/wishlist
extra2.post('/wishlist', async (c) => {
  const user = c.get('user');
  type Body = { plantId?: string; customName?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const plantId = body.plantId?.trim();
  const customName = body.customName?.trim().slice(0, 60);
  const dariKatalog = !!plantId && PLANT_BY_ID.has(plantId);

  // Baris wishlist harus punya salah satu sumber nama. plantId yang tidak
  // dikenal katalog dianggap tidak ada sama sekali — tanpa syarat ini,
  // kiriman berisi plantId asal-asalan dan tanpa customName lolos validasi
  // lalu tersimpan dengan kedua kolom NULL, jadi baris tanpa nama yang
  // hanya bisa dihapus.
  if (!dariKatalog && !customName) {
    return c.json({ error: 'plantId dari katalog atau customName wajib diisi' }, 400);
  }

  const id = nanoid();
  await c.env.DB.prepare(
    'INSERT INTO garden_wishlist (id, user_id, plant_id, custom_name, note) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(
    id, user.sub,
    dariKatalog ? plantId! : null,
    dariKatalog ? null : customName!,
    body.note?.trim().slice(0, 200) || null
  ).run();

  return c.json({ id, ok: true }, 201);
});

// DELETE /api/garden/wishlist/:id
extra2.delete('/wishlist/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_wishlist WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

// ──────────────────── #5 TREN TAHUN-KE-TAHUN ────────────────────

// GET /api/garden/yearly-trend — nilai panen dan biaya per tahun, dengan titik balik modal
extra2.get('/yearly-trend', async (c) => {
  const user = c.get('user');

  const yearRows = (await c.env.DB.prepare(
    `SELECT substr(action_date, 1, 4) AS y FROM garden_care_log
      WHERE user_id = ?1 AND action = 'panen' AND amount IS NOT NULL
     UNION
     SELECT substr(cost_date, 1, 4) AS y FROM garden_costs WHERE user_id = ?1`
  ).bind(user.sub).all<{ y: string }>()).results ?? [];

  const years = [...new Set(yearRows.map((r) => r.y).filter((y) => /^\d{4}$/.test(y)))]
    .sort()
    .slice(-10); // sepuluh tahun terakhir cukup untuk tren yang berarti

  if (years.length === 0) return c.json({ years: [], breakEvenYear: null, cumulativeNet: 0 });

  const priceRes = await c.env.DB.prepare('SELECT plant_key, price_idr FROM garden_plant_price WHERE user_id = ?1')
    .bind(user.sub).all<{ plant_key: string; price_idr: number }>();
  const prices = new Map<string, number>();
  for (const p of priceRes.results ?? []) prices.set(p.plant_key, p.price_idr);

  // Satu kueri untuk SELURUH rentang, lalu dikelompokkan per tahun di memori.
  // Versi sebelumnya menjalankan dua kueri per tahun di dalam perulangan —
  // sampai dua puluh perjalanan bolak-balik ke D1 untuk satu layar, dan
  // biayanya tumbuh tiap tahun kebun ini dipakai.
  const from = `${years[0]}-01-01`;
  const to = `${years[years.length - 1]}-12-31`;

  const [harvestRes, costRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT substr(l.action_date, 1, 4) AS tahun, p.plant_id, p.nickname, p.custom_name, l.amount, l.unit
         FROM garden_care_log l
         JOIN garden_plantings p ON p.id = l.planting_id
        WHERE l.user_id = ?1 AND l.action = 'panen' AND l.amount IS NOT NULL
          AND l.action_date >= ?2 AND l.action_date <= ?3`
    ).bind(user.sub, from, to).all<{
      tahun: string; plant_id: string | null; nickname: string | null;
      custom_name: string | null; amount: number; unit: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT substr(cost_date, 1, 4) AS tahun, COALESCE(SUM(amount_idr), 0) AS total
         FROM garden_costs
        WHERE user_id = ?1 AND cost_date >= ?2 AND cost_date <= ?3
        GROUP BY tahun`
    ).bind(user.sub, from, to).all<{ tahun: string; total: number }>(),
  ]);

  const panenPerTahun = new Map<string, HarvestEntry[]>();
  for (const r of harvestRes.results ?? []) {
    const plant = r.plant_id ? PLANT_BY_ID.get(r.plant_id) : undefined;
    const list = panenPerTahun.get(r.tahun) ?? [];
    list.push({
      key: priceKey(r.plant_id, r.custom_name),
      name: r.nickname || plant?.name || r.custom_name || 'Tanaman',
      amount: r.amount,
      unit: r.unit ?? 'kg',
      date: `${r.tahun}-01-01`,
    });
    panenPerTahun.set(r.tahun, list);
  }

  const biayaPerTahun = new Map((costRes.results ?? []).map((r) => [r.tahun, r.total]));

  const totals: YearlyTotal[] = years.map((year) => {
    const panen = panenPerTahun.get(year) ?? [];
    const nilai = buildKitchenReport(panen, prices, 0, `${year}-01-01`, `${year}-12-31`);
    return { year: Number(year), cost: biayaPerTahun.get(year) ?? 0, value: nilai.harvestValueIdr };
  });

  return c.json(computeBreakEven(totals));
});

// ──────────────────── #7 PANEN VS TERBUANG ────────────────────

// GET /api/garden/waste-report — dari panen yang masuk Inventaris, berapa terpakai vs terbuang
extra2.get('/waste-report', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = (await c.env.DB.prepare(
    `SELECT i.quantity, i.expiry_date
       FROM garden_harvest_stock h
       JOIN inventory_items i ON i.id = h.inventory_item_id
      WHERE h.user_id = ?1`
  ).bind(user.sub).all<{ quantity: number; expiry_date: string | null }>()).results ?? [];

  const items: ItemPanen[] = rows.map((r) => ({ quantity: r.quantity, expiryDate: r.expiry_date }));
  return c.json(laporanTerbuang(items, today));
});

// ──────────────────── #8 PENGINGAT SANITASI ────────────────────

// GET /api/garden/sanitation — lokasi yang perlu dibersihkan sebelum tanam ulang
extra2.get('/sanitation', async (c) => {
  const user = c.get('user');

  // Tanaman yang sudah berakhir (gagal/selesai), dan tanaman yang sedang
  // tumbuh sekarang — dipasangkan lewat lokasi atau bedengan yang sama.
  const [ended, active, bedRows, cleanedRows] = await Promise.all([
    c.env.DB.prepare(
      // Tanggal berakhir didekati dengan aktivitas perawatan TERAKHIR, apa pun
      // jenisnya — bukan hanya 'catatan'. Menyaring satu jenis aksi saja
      // membuat tanaman yang berakhir sesudah panen tidak punya baris yang
      // cocok, jadi COALESCE jatuh ke tanggal TANAM: jendela sanitasi lalu
      // dihitung dari awal siklus, bukan akhirnya, dan pembersihan yang
      // sungguhan dilakukan tetap dianggap belum ada.
      `SELECT p.location, s.bed_id, p.planted_date,
              COALESCE(MAX(l.action_date), p.planted_date) AS end_date
         FROM garden_plantings p
         LEFT JOIN garden_bed_slots s ON s.planting_id = p.id
         LEFT JOIN garden_care_log l ON l.planting_id = p.id
        WHERE p.user_id = ?1 AND p.status IN ('gagal', 'selesai')
        GROUP BY p.id`
    ).bind(user.sub).all<{ location: string | null; bed_id: string | null; planted_date: string; end_date: string }>(),
    c.env.DB.prepare(
      `SELECT p.location, s.bed_id, p.planted_date
         FROM garden_plantings p
         LEFT JOIN garden_bed_slots s ON s.planting_id = p.id
        WHERE p.user_id = ?1 AND p.status = 'tumbuh'`
    ).bind(user.sub).all<{ location: string | null; bed_id: string | null; planted_date: string }>(),
    c.env.DB.prepare('SELECT id, name FROM garden_beds WHERE user_id = ?1').bind(user.sub)
      .all<{ id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT bed_id, location, MAX(cleaned_date) AS cleaned_date FROM garden_sanitation_log
        WHERE user_id = ?1 GROUP BY bed_id, location`
    ).bind(user.sub).all<{ bed_id: string | null; location: string | null; cleaned_date: string }>(),
  ]);

  const bedNames = new Map((bedRows.results ?? []).map((b) => [b.id, b.name]));
  const lastCleaned = new Map<string, string>();
  for (const r of cleanedRows.results ?? []) {
    const key = r.bed_id ?? `loc:${r.location}`;
    lastCleaned.set(key, r.cleaned_date);
  }

  // Pasangan (lokasi lama yang berakhir, lokasi baru yang mulai) yang sama
  // persis — bed_id kalau ada koordinatnya, kalau tidak lewat teks location.
  const riwayat: RiwayatLokasi[] = [];
  for (const e of ended.results ?? []) {
    const key = e.bed_id ?? (e.location ? `loc:${e.location}` : null);
    if (!key) continue;
    const match = (active.results ?? []).find((a) => (a.bed_id ?? (a.location ? `loc:${a.location}` : null)) === key);
    if (!match) continue;
    riwayat.push({
      lokasiId: key,
      lokasiLabel: e.bed_id ? (bedNames.get(e.bed_id) ?? 'Bedengan') : (e.location ?? 'Lokasi'),
      prevEndDate: e.end_date,
      newStartDate: match.planted_date,
    });
  }

  return c.json({ warnings: cariPerluSanitasi(riwayat, lastCleaned) });
});

// POST /api/garden/sanitation — catat pembersihan
extra2.post('/sanitation', async (c) => {
  const user = c.get('user');
  type Body = { lokasiId?: string; bedId?: string; location?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  // `lokasiId` adalah kunci yang sama persis dengan yang dibawa peringatan —
  // dikembalikan apa adanya, lalu dibongkar di sini. Sebelumnya layar
  // mengirim balik LABEL-nya sebagai `location`, sehingga pembersihan
  // bedengan tersimpan sebagai lokasi teks bernama sama dan tidak pernah
  // cocok dengan peringatan yang berkunci bed_id: tombolnya bekerja tapi
  // peringatannya tidak pernah hilang.
  let bedId = body.bedId?.trim() || null;
  let location = body.location?.trim() || null;
  const lokasiId = body.lokasiId?.trim();
  if (lokasiId) {
    if (lokasiId.startsWith('loc:')) { location = lokasiId.slice(4); bedId = null; }
    else { bedId = lokasiId; location = null; }
  }

  if (!bedId && !location) {
    return c.json({ error: 'lokasiId, bedId, atau location wajib diisi' }, 400);
  }

  // Bedengan yang tidak dimiliki tidak boleh menghasilkan baris pembersihan:
  // tanpa cek ini, id tebakan menambah baris atas nama bedengan orang lain.
  if (bedId) {
    const owned = await c.env.DB.prepare('SELECT id FROM garden_beds WHERE id = ?1 AND user_id = ?2')
      .bind(bedId, user.sub).first<{ id: string }>();
    if (!owned) return c.json({ error: 'bedengan tidak ditemukan' }, 404);
  }

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_sanitation_log (id, user_id, bed_id, location, cleaned_date, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    id, user.sub, bedId, location,
    jakartaToday(), body.note?.trim().slice(0, 200) || null
  ).run();

  return c.json({ id, ok: true }, 201);
});

// ──────────────────── #9 TAMPUNGAN AIR HUJAN ────────────────────

// GET /api/garden/rainwater — catatan + ringkasan
extra2.get('/rainwater', async (c) => {
  const user = c.get('user');

  const [logRes, settingsRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, log_date, liters_collected, liters_used, note FROM garden_rainwater_log
        WHERE user_id = ?1 ORDER BY log_date DESC LIMIT 60`
    ).bind(user.sub).all<{ id: string; log_date: string; liters_collected: number; liters_used: number; note: string | null }>(),
    c.env.DB.prepare('SELECT tariff_rp_per_liter FROM garden_rainwater_settings WHERE user_id = ?1')
      .bind(user.sub).first<{ tariff_rp_per_liter: number }>(),
  ]);

  const rows = logRes.results ?? [];
  const tarif = settingsRow?.tariff_rp_per_liter ?? 0;
  const ringkasan = ringkasAirHujan(rows.map((r) => ({ litersCollected: r.liters_collected, litersUsed: r.liters_used })), tarif);

  return c.json({
    log: rows.map((r) => ({ id: r.id, date: r.log_date, litersCollected: r.liters_collected, litersUsed: r.liters_used, note: r.note })),
    tarifRpPerLiter: tarif,
    ringkasan,
  });
});

// PUT /api/garden/rainwater/tarif — atur tarif Rp per liter
extra2.put('/rainwater/tarif', async (c) => {
  const user = c.get('user');
  type Body = { tarifRpPerLiter?: number };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const tarif = typeof body.tarifRpPerLiter === 'number' && body.tarifRpPerLiter >= 0
    ? Math.round(body.tarifRpPerLiter)
    : 0;

  await c.env.DB.prepare(
    `INSERT INTO garden_rainwater_settings (user_id, tariff_rp_per_liter, updated_at)
     VALUES (?1, ?2, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET tariff_rp_per_liter = ?2, updated_at = unixepoch()`
  ).bind(user.sub, tarif).run();

  return c.json({ ok: true });
});

// POST /api/garden/rainwater — catat satu entri
extra2.post('/rainwater', async (c) => {
  const user = c.get('user');
  type Body = { date?: string; litersCollected?: number; litersUsed?: number; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : jakartaToday();
  const litersCollected = typeof body.litersCollected === 'number' && body.litersCollected > 0 ? body.litersCollected : 0;
  const litersUsed = typeof body.litersUsed === 'number' && body.litersUsed > 0 ? body.litersUsed : 0;

  if (litersCollected === 0 && litersUsed === 0) {
    return c.json({ error: 'isi liters tertampung atau terpakai' }, 400);
  }

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_rainwater_log (id, user_id, log_date, liters_collected, liters_used, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(id, user.sub, date, litersCollected, litersUsed, body.note?.trim().slice(0, 200) || null).run();

  return c.json({ id, ok: true }, 201);
});

// DELETE /api/garden/rainwater/:id
extra2.delete('/rainwater/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_rainwater_log WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

export default extra2;
