/**
 * Uji tanah, perbanyakan, Pranata Mangsa, jadwal semai mundur, media tanam,
 * dan kecocokan ketinggian.
 *
 * Berkas keempat untuk modul kebun, mengikuti pemisahan yang sudah ada:
 * garden_extra.ts gelombang pertama, garden_extra2.ts kedua, garden_extra3.ts
 * ketiga. Dipasang di prefix yang sama, jadi bagi klien tetap satu API Kebun.
 *
 * Benang merah gelombang ini: tiga kolom katalog yang sudah lama tersimpan
 * tapi tidak pernah dibandingkan dengan apa pun — `phRange`, `altitude`, dan
 * `propagation`. Bentuknya sama seperti peta matahari: katalog menyimpan
 * SYARAT, dan yang hilang selama ini adalah KENYATAAN di kebun ini untuk
 * dibandingkan dengannya.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { PLANTS, PLANT_BY_ID, dipanen } from '../data/plants';
import { loadSettings, num } from '../lib/settings';
import {
  bersihkanPh, cariSalahTanah, ujiTerbaru,
  type UjiTanah, type TanamanDiLokasi,
} from '../lib/garden_soil';
import {
  parseMetode, ringkasMetode, tingkatBerhasil, METODE_LABEL,
  type Metode, type CatatanPerbanyakan,
} from '../lib/garden_propagation';
import { MANGSA, mangsaPada, mangsaBerikutnya, musimMangsaKe } from '../lib/garden_mangsa';
import { jadwalMundur, semaiTerlambat } from '../lib/garden_seedling_schedule';
import { bersihkanMedia, butuhSiram, tugasMedia, MEDIA_LABEL, type Media } from '../lib/garden_media';
import { parseSeason } from '../lib/garden_season';
import { cocokKetinggian, parseAltitude } from '../lib/garden_altitude';

const extra4 = new Hono<AuthContext>();
extra4.use('/*', requireAuth);

const TEKSTUR = ['pasir', 'lempung', 'liat'] as const;
const METODE_SAH = Object.keys(METODE_LABEL) as Metode[];

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal yang sah, atau null. Dipakai sebelum nilainya masuk ke SQL. */
function tanggalSah(v: unknown): string | null {
  return typeof v === 'string' && TANGGAL.test(v) ? v : null;
}

/** Bilangan cacah untuk jumlah stek. Negatif dan pecahan bukan jawaban yang sah. */
function cacah(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Kunci lokasi yang seragam di seluruh modul kebun: id bedengan apa adanya,
 * atau teks lokasi dengan awalan `loc:`.
 *
 * Perjanjian yang sama dipakai peta matahari (garden_extra3.ts) dan peringatan
 * sanitasi. Satu perjanjian untuk seluruh modul, bukan tiga yang harus dijaga
 * tetap sama sendiri-sendiri.
 */
function lokasiIdDari(bedId: string | null, location: string | null): string | null {
  if (bedId) return bedId;
  const teks = location?.trim();
  return teks ? `loc:${teks}` : null;
}

/** Penanaman aktif beserta lokasi dan namanya — dipakai tiga endpoint di bawah. */
async function muatPenanamanAktif(db: D1Database, userId: string) {
  return (await db.prepare(
    `SELECT p.id, p.plant_id, p.custom_name, p.nickname, p.location, s.bed_id
       FROM garden_plantings p
       LEFT JOIN garden_bed_slots s ON s.planting_id = p.id
      WHERE p.user_id = ?1 AND p.status IN ('tumbuh', 'panen')`
  ).bind(userId).all<{
    id: string; plant_id: string | null; custom_name: string | null;
    nickname: string | null; location: string | null; bed_id: string | null;
  }>()).results ?? [];
}

function namaPenanaman(r: {
  plant_id: string | null; custom_name: string | null; nickname: string | null;
}): string {
  return r.nickname
    ?? (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.name : undefined)
    ?? r.custom_name
    ?? 'Tanaman';
}

// ──────────────────────── #1 UJI TANAH ────────────────────────

// GET /api/garden/soil — uji terbaru per lokasi + tanaman yang salah tanah
extra4.get('/soil', async (c) => {
  const user = c.get('user');

  const [ujiRows, plantingRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, lokasi_id, lokasi_label, ph, texture, tested_date, note
         FROM garden_soil_test WHERE user_id = ?1
        ORDER BY tested_date DESC, created_at DESC`
    ).bind(user.sub).all<{
      id: string; lokasi_id: string; lokasi_label: string; ph: number;
      texture: string | null; tested_date: string; note: string | null;
    }>(),
    muatPenanamanAktif(c.env.DB, user.sub),
  ]);

  const semuaUji = ujiRows.results ?? [];
  const uji: UjiTanah[] = semuaUji.map((r) => ({
    lokasiId: r.lokasi_id,
    lokasiLabel: r.lokasi_label,
    ph: r.ph,
    texture: r.texture,
    testedDate: r.tested_date,
  }));

  const tanaman: TanamanDiLokasi[] = [];
  for (const r of plantingRows) {
    const lokasiId = lokasiIdDari(r.bed_id, r.location);
    if (!lokasiId) continue;
    tanaman.push({
      plantingId: r.id,
      nama: namaPenanaman(r),
      plantId: r.plant_id,
      lokasiId,
    });
  }

  const phByPlant = new Map<string, [number, number]>(
    PLANTS.map((p) => [p.id, p.phRange])
  );

  const terbaru = ujiTerbaru(uji);

  // Lokasi yang sudah ditanami tapi belum pernah diuji: tanpa daftar ini,
  // "tidak ada peringatan" terbaca seperti "tanahnya baik-baik saja", padahal
  // artinya belum ada yang diukur.
  const belumDiuji = [...new Map(
    tanaman
      .filter((t) => !terbaru.has(t.lokasiId))
      .map((t) => [t.lokasiId, { lokasiId: t.lokasiId, contohTanaman: t.nama }])
  ).values()];

  return c.json({
    riwayat: semuaUji.map((r) => ({
      id: r.id,
      lokasiId: r.lokasi_id,
      lokasiLabel: r.lokasi_label,
      ph: r.ph,
      texture: r.texture,
      testedDate: r.tested_date,
      note: r.note,
      terbaru: terbaru.get(r.lokasi_id)?.testedDate === r.tested_date,
    })),
    salahTanah: cariSalahTanah(tanaman, uji, phByPlant),
    belumDiuji,
    tekstur: TEKSTUR,
  });
});

// POST /api/garden/soil — simpan satu hasil uji
extra4.post('/soil', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    lokasiId?: string; lokasiLabel?: string; ph?: unknown;
    texture?: string; testedDate?: string; note?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const lokasiId = body.lokasiId?.trim();
  if (!lokasiId) return c.json({ error: 'lokasi wajib diisi' }, 400);

  const ph = bersihkanPh(body.ph);
  if (ph === null) return c.json({ error: 'pH harus angka antara 3.5 dan 9.5' }, 400);

  const texture = TEKSTUR.includes(body.texture as never) ? body.texture! : null;
  const testedDate = tanggalSah(body.testedDate) ?? jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_soil_test (id, user_id, lokasi_id, lokasi_label, ph, texture, tested_date, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    id, user.sub, lokasiId,
    (body.lokasiLabel?.trim() || lokasiId.replace(/^loc:/, '')).slice(0, 120),
    ph, texture, testedDate, body.note?.trim().slice(0, 300) || null
  ).run();

  return c.json({ id, ph, testedDate });
});

// DELETE /api/garden/soil/:id
extra4.delete('/soil/:id', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM garden_soil_test WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).run();

  // 404 kalau tidak ada yang terhapus, bukan ok:true. Klausa user_id sudah
  // menjamin data pengguna lain tidak tersentuh, tapi menjawab "berhasil"
  // untuk penghapusan yang tidak terjadi membuat layar menghapus barisnya
  // sendiri lalu memunculkannya lagi saat dimuat ulang.
  if ((res.meta?.changes ?? 0) === 0) return c.json({ error: 'uji tanah tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ──────────────────────── #2 PERBANYAKAN ────────────────────────

// GET /api/garden/propagation — catatan + ringkasan per metode + saran katalog
extra4.get('/propagation', async (c) => {
  const user = c.get('user');

  const rows = (await c.env.DB.prepare(
    `SELECT id, plant_id, custom_name, method, started_date, count_started,
            count_rooted, rooted_date, source_planting_id, note
       FROM garden_propagation WHERE user_id = ?1
      ORDER BY started_date DESC, created_at DESC`
  ).bind(user.sub).all<{
    id: string; plant_id: string | null; custom_name: string | null; method: string;
    started_date: string; count_started: number; count_rooted: number | null;
    rooted_date: string | null; source_planting_id: string | null; note: string | null;
  }>()).results ?? [];

  const catatan: CatatanPerbanyakan[] = rows.map((r) => ({
    plantId: r.plant_id,
    nama: r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.name ?? r.custom_name ?? 'Tanaman' : r.custom_name ?? 'Tanaman',
    method: r.method as Metode,
    countStarted: r.count_started,
    countRooted: r.count_rooted,
  }));

  // Metode yang disarankan katalog untuk tanaman yang sedang ditanam. Ini yang
  // membuat kolom `propagation` akhirnya berguna: bukan lagi teks yang dibaca
  // sekali di modal, melainkan daftar yang bisa langsung dicoba.
  const aktif = await muatPenanamanAktif(c.env.DB, user.sub);

  interface SaranKatalog {
    plantId: string;
    nama: string;
    emoji: string;
    teks: string;
    metode: Array<{ method: Metode; label: string }>;
  }

  // Map, bukan array: satu tanaman bisa ditanam di beberapa tempat sekaligus,
  // dan sarannya cukup muncul sekali.
  const saranMap = new Map<string, SaranKatalog>();
  for (const r of aktif) {
    if (!r.plant_id || saranMap.has(r.plant_id)) continue;
    const plant = PLANT_BY_ID.get(r.plant_id);
    if (!plant) continue;

    const metode = parseMetode(plant.propagation).map((m) => ({ method: m, label: METODE_LABEL[m] }));
    if (metode.length === 0) continue;

    saranMap.set(plant.id, {
      plantId: plant.id,
      nama: plant.name,
      emoji: plant.emoji,
      teks: plant.propagation,
      metode,
    });
  }
  const saranKatalog = [...saranMap.values()];

  return c.json({
    catatan: rows.map((r, i) => ({
      id: r.id,
      plantId: r.plant_id,
      nama: catatan[i].nama,
      method: r.method,
      methodLabel: METODE_LABEL[r.method as Metode] ?? r.method,
      startedDate: r.started_date,
      countStarted: r.count_started,
      countRooted: r.count_rooted,
      rootedDate: r.rooted_date,
      rate: tingkatBerhasil(r.count_started, r.count_rooted),
      note: r.note,
    })),
    ringkasan: ringkasMetode(catatan),
    saranKatalog,
    metodeSah: METODE_SAH.map((m) => ({ method: m, label: METODE_LABEL[m] })),
  });
});

// POST /api/garden/propagation — catat batch baru
extra4.post('/propagation', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    plantId?: string; customName?: string; method?: string;
    startedDate?: string; countStarted?: unknown; sourcePlantingId?: string; note?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const method = body.method as Metode;
  if (!METODE_SAH.includes(method)) return c.json({ error: 'metode tidak dikenal' }, 400);

  const countStarted = cacah(body.countStarted);
  if (countStarted === null || countStarted < 1) {
    return c.json({ error: 'jumlah yang dipasang harus minimal 1' }, 400);
  }

  const plantId = body.plantId?.trim() || null;
  if (plantId && !PLANT_BY_ID.has(plantId)) {
    return c.json({ error: 'tanaman tidak ada di katalog' }, 400);
  }
  const customName = body.customName?.trim().slice(0, 80) || null;
  if (!plantId && !customName) return c.json({ error: 'tanaman wajib diisi' }, 400);

  // Penanaman sumber harus milik pengguna ini. Tanpa pemeriksaan ini, id milik
  // orang lain bisa dititipkan lewat body dan ikut tersimpan.
  let sourcePlantingId: string | null = null;
  if (body.sourcePlantingId) {
    const ada = await c.env.DB.prepare(
      'SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
    ).bind(body.sourcePlantingId, user.sub).first<{ id: string }>();
    if (!ada) return c.json({ error: 'tanaman induk tidak ditemukan' }, 404);
    sourcePlantingId = ada.id;
  }

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_propagation
       (id, user_id, plant_id, custom_name, source_planting_id, method, started_date, count_started, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    id, user.sub, plantId, customName, sourcePlantingId, method,
    tanggalSah(body.startedDate) ?? jakartaToday(),
    countStarted, body.note?.trim().slice(0, 300) || null
  ).run();

  return c.json({ id, method, countStarted });
});

// PATCH /api/garden/propagation/:id — isi berapa yang akhirnya berakar
extra4.patch('/propagation/:id', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ countRooted?: unknown; rootedDate?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const countRooted = cacah(body.countRooted);
  if (countRooted === null) return c.json({ error: 'jumlah berakar harus angka 0 atau lebih' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT count_started FROM garden_propagation WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).first<{ count_started: number }>();
  if (!row) return c.json({ error: 'catatan tidak ditemukan' }, 404);

  // Lebih banyak yang berakar daripada yang dipasang adalah salah ketik, dan
  // kalau disimpan akan melahirkan tingkat keberhasilan di atas 100%.
  if (countRooted > row.count_started) {
    return c.json({ error: `jumlah berakar tidak boleh lebih dari ${row.count_started}` }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE garden_propagation SET count_rooted = ?1, rooted_date = ?2
      WHERE id = ?3 AND user_id = ?4`
  ).bind(
    countRooted,
    tanggalSah(body.rootedDate) ?? jakartaToday(),
    c.req.param('id'), user.sub
  ).run();

  return c.json({ countRooted, rate: tingkatBerhasil(row.count_started, countRooted) });
});

// DELETE /api/garden/propagation/:id
extra4.delete('/propagation/:id', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM garden_propagation WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).run();

  if ((res.meta?.changes ?? 0) === 0) return c.json({ error: 'catatan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ──────────────────────── #3 PRANATA MANGSA ────────────────────────

// GET /api/garden/mangsa — mangsa berjalan, berikutnya, dan tanaman yang cocok
extra4.get('/mangsa', async (c) => {
  const hariIni = jakartaToday();
  const sekarang = mangsaPada(hariIni);
  const nanti = mangsaBerikutnya(sekarang);
  const musim = musimMangsaKe(sekarang.musim);

  // Katalog menyimpan musim sebagai teks bebas; parseSeason sudah membacanya
  // untuk kalender tanam biasa, jadi dipakai ulang di sini alih-alih menulis
  // pembaca kedua yang harus dijaga tetap sepakat dengan yang pertama.
  const cocok = PLANTS
    .filter((p) => dipanen(p))
    .filter((p) => {
      const musimTanaman = parseSeason(p.season);
      return musimTanaman.includes('sepanjang-tahun') || musimTanaman.includes(musim);
    })
    .map((p) => ({
      plantId: p.id,
      nama: p.name,
      emoji: p.emoji,
      season: p.season,
      idealSekarang: parseSeason(p.season).includes(musim),
    }))
    .sort((a, b) => Number(b.idealSekarang) - Number(a.idealSekarang) || a.nama.localeCompare(b.nama))
    .slice(0, 24);

  return c.json({
    hariIni,
    sekarang: { ...sekarang, musimSederhana: musim },
    berikutnya: { urutan: nanti.urutan, nama: nanti.nama, mulai: nanti.mulai, musim: nanti.musim },
    semua: MANGSA.map((m) => ({ urutan: m.urutan, nama: m.nama, mulai: m.mulai, selesai: m.selesai, musim: m.musim })),
    cocokDitanam: cocok,
  });
});

// ──────────────────── #4 JADWAL SEMAI MUNDUR ────────────────────

// GET /api/garden/seedling-schedule?target=YYYY-MM-DD
extra4.get('/seedling-schedule', async (c) => {
  const target = c.req.query('target');
  if (!tanggalSah(target)) {
    return c.json({ error: 'target harus tanggal YYYY-MM-DD' }, 400);
  }

  const hariIni = jakartaToday();

  const jadwal = PLANTS
    .filter((p) => dipanen(p))
    .map((p) => {
      const j = jadwalMundur(target!, p.propagation);
      if (!j) return null;
      return {
        plantId: p.id,
        nama: p.name,
        emoji: p.emoji,
        propagation: p.propagation,
        ...j,
        terlambatHari: semaiTerlambat(j, hariIni),
      };
    })
    // Tanaman yang ditanam benih langsung memang tidak punya tahap semai;
    // memaksakan jadwal untuknya berarti mengarang tahap yang tidak ada.
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.mulaiSemai.localeCompare(b.mulaiSemai));

  return c.json({ target, hariIni, jadwal });
});

// ──────────────────────── #5 MEDIA TANAM ────────────────────────

// GET /api/garden/media — media tiap penanaman + tugas tambahan hari ini
extra4.get('/media', async (c) => {
  const user = c.get('user');
  const hariIni = jakartaToday();

  const [aktif, mediaRows] = await Promise.all([
    muatPenanamanAktif(c.env.DB, user.sub),
    c.env.DB.prepare(
      `SELECT planting_id, media, last_solution_change, note
         FROM garden_planting_media WHERE user_id = ?1`
    ).bind(user.sub).all<{
      planting_id: string; media: string; last_solution_change: string | null; note: string | null;
    }>(),
  ]);

  const byPlanting = new Map((mediaRows.results ?? []).map((r) => [r.planting_id, r]));

  const daftar = aktif.map((r) => {
    const simpan = byPlanting.get(r.id);
    // Penanaman tanpa baris di tabel media memang di tanah — itu bawaannya,
    // dan justru sebabnya tabelnya dibuat terpisah.
    const media: Media = bersihkanMedia(simpan?.media);
    return {
      plantingId: r.id,
      nama: namaPenanaman(r),
      media,
      mediaLabel: MEDIA_LABEL[media],
      butuhSiram: butuhSiram(media),
      lastSolutionChange: simpan?.last_solution_change ?? null,
      tugas: tugasMedia(media, simpan?.last_solution_change ?? null, hariIni),
      note: simpan?.note ?? null,
    };
  });

  return c.json({
    hariIni,
    daftar,
    pilihan: (Object.keys(MEDIA_LABEL) as Media[]).map((m) => ({ media: m, label: MEDIA_LABEL[m] })),
  });
});

// PUT /api/garden/media/:plantingId — set media satu penanaman
extra4.put('/media/:plantingId', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('plantingId');
  const body = await c.req.json<{
    media?: unknown; lastSolutionChange?: string; note?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const ada = await c.env.DB.prepare(
    'SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, user.sub).first<{ id: string }>();
  if (!ada) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const media = bersihkanMedia(body.media);

  // Tanggal ganti larutan hanya berarti untuk hidroponik. Menyimpannya untuk
  // media lain akan memunculkan tanggal yang tidak pernah dipakai apa pun.
  const lastSolutionChange = media === 'hidroponik'
    ? tanggalSah(body.lastSolutionChange)
    : null;

  await c.env.DB.prepare(
    `INSERT INTO garden_planting_media (planting_id, user_id, media, last_solution_change, note, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())
     ON CONFLICT(planting_id) DO UPDATE SET
       media = excluded.media,
       last_solution_change = excluded.last_solution_change,
       note = excluded.note,
       updated_at = unixepoch()`
  ).bind(
    plantingId, user.sub, media, lastSolutionChange,
    body.note?.trim().slice(0, 300) || null
  ).run();

  return c.json({
    plantingId,
    media,
    mediaLabel: MEDIA_LABEL[media],
    butuhSiram: butuhSiram(media),
    tugas: tugasMedia(media, lastSolutionChange, jakartaToday()),
  });
});

// ──────────────────────── #6 KETINGGIAN ────────────────────────

// GET /api/garden/altitude — mdpl tersimpan + tanaman yang tidak cocok di situ
extra4.get('/altitude', async (c) => {
  const user = c.get('user');
  const settings = await loadSettings(c.env.DB, user.sub);
  const mdpl = num(settings, 'garden.altitude_mdpl');

  const aktif = await muatPenanamanAktif(c.env.DB, user.sub);

  const salahTempat = aktif
    .filter((r) => r.plant_id)
    .map((r) => {
      const plant = PLANT_BY_ID.get(r.plant_id!)!;
      const status = cocokKetinggian(plant.altitude, mdpl);
      if (status === 'cocok') return null;
      const [min, max] = parseAltitude(plant.altitude);
      return {
        plantingId: r.id,
        nama: namaPenanaman(r),
        plantId: plant.id,
        altitude: plant.altitude,
        rentang: [min, max] as [number, number],
        status,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Katalog yang cocok di ketinggian ini — dipakai layar untuk menyarankan
  // pengganti tanpa perlu permintaan kedua.
  const cocok = PLANTS
    .filter((p) => dipanen(p) && cocokKetinggian(p.altitude, mdpl) === 'cocok')
    .map((p) => ({ plantId: p.id, nama: p.name, emoji: p.emoji, altitude: p.altitude }));

  return c.json({ mdpl, salahTempat, cocokCount: cocok.length, cocok: cocok.slice(0, 24) });
});

export default extra4;
