/**
 * Peta matahari, benih simpanan sendiri, dan lembar kerja mingguan.
 *
 * Berkas ketiga untuk modul kebun, mengikuti pemisahan yang sudah ada:
 * garden_extra.ts memuat gelombang pertama, garden_extra2.ts gelombang kedua.
 * Dipasang di prefix yang sama, jadi bagi klien tetap satu API Kebun.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { PLANT_BY_ID } from '../data/plants';
import { priceKey } from '../lib/garden_kitchen';
import {
  cariSalahTempat, lokasiCocokUntuk, bersihkanJam, KEBUTUHAN_JAM, LABEL_SUNLIGHT,
  type ProfilMatahari, type PenanamanUntukCek, type Sunlight,
} from '../lib/garden_sun';
import {
  generasiBerikutnya, ringkasGalur, labelGenerasi,
  type BenihSimpanan, type HasilGalur,
} from '../lib/garden_seed_lineage';

const extra3 = new Hono<AuthContext>();
extra3.use('/*', requireAuth);

const ORIENTASI = ['utara', 'timur', 'selatan', 'barat', 'campuran'] as const;

/**
 * Kunci lokasi yang seragam di seluruh modul kebun: id bedengan apa adanya,
 * atau teks lokasi dengan awalan `loc:`.
 *
 * Perjanjian yang sama dipakai peringatan sanitasi. Satu perjanjian untuk
 * seluruh modul, bukan dua yang harus dijaga tetap sama sendiri-sendiri —
 * pernah ada bug persis dari dua sisi yang memakai kunci berbeda.
 */
function bongkarLokasiId(lokasiId: string): { bedId: string | null; location: string | null } {
  return lokasiId.startsWith('loc:')
    ? { bedId: null, location: lokasiId.slice(4) }
    : { bedId: lokasiId, location: null };
}

// ──────────────────── #1 PETA MATAHARI ────────────────────

/** Profil matahari milik pengguna, sudah dibersihkan. */
async function muatProfil(db: D1Database, userId: string): Promise<ProfilMatahari[]> {
  const rows = (await db.prepare(
    `SELECT lokasi_id, lokasi_label, hours_direct FROM garden_sun_profile
      WHERE user_id = ?1 ORDER BY hours_direct DESC`
  ).bind(userId).all<{ lokasi_id: string; lokasi_label: string; hours_direct: number }>()).results ?? [];

  return rows.map((r) => ({
    lokasiId: r.lokasi_id,
    lokasiLabel: r.lokasi_label,
    jamLangsung: r.hours_direct,
  }));
}

// GET /api/garden/sun-map — profil tiap lokasi + tanaman yang salah tempat
extra3.get('/sun-map', async (c) => {
  const user = c.get('user');

  const [profilRows, plantingRows, bedRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT lokasi_id, lokasi_label, hours_direct, orientation, note FROM garden_sun_profile
        WHERE user_id = ?1 ORDER BY hours_direct DESC`
    ).bind(user.sub).all<{
      lokasi_id: string; lokasi_label: string; hours_direct: number;
      orientation: string | null; note: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT p.id, p.plant_id, p.custom_name, p.nickname, p.location, s.bed_id
         FROM garden_plantings p
         LEFT JOIN garden_bed_slots s ON s.planting_id = p.id
        WHERE p.user_id = ?1 AND p.status IN ('tumbuh', 'panen')`
    ).bind(user.sub).all<{
      id: string; plant_id: string | null; custom_name: string | null;
      nickname: string | null; location: string | null; bed_id: string | null;
    }>(),
    c.env.DB.prepare('SELECT id, name FROM garden_beds WHERE user_id = ?1').bind(user.sub)
      .all<{ id: string; name: string }>(),
  ]);

  const profil: ProfilMatahari[] = (profilRows.results ?? []).map((r) => ({
    lokasiId: r.lokasi_id, lokasiLabel: r.lokasi_label, jamLangsung: r.hours_direct,
  }));

  const penanaman: PenanamanUntukCek[] = (plantingRows.results ?? []).map((p) => {
    const plant = p.plant_id ? PLANT_BY_ID.get(p.plant_id) : undefined;
    return {
      plantingId: p.id,
      label: p.nickname || plant?.name || p.custom_name || 'Tanaman',
      lokasiId: p.bed_id ?? (p.location ? `loc:${p.location}` : null),
      butuh: (plant?.sunlight as Sunlight | undefined) ?? null,
    };
  });

  // Lokasi yang dipakai tanaman tapi belum punya profil — inilah yang perlu
  // diamati berikutnya, dan tanpa daftar ini pengguna harus mengingatnya sendiri.
  const sudahAda = new Set(profil.map((p) => p.lokasiId));
  const bedNames = new Map((bedRows.results ?? []).map((b) => [b.id, b.name]));
  const belumDiukur = new Map<string, string>();
  for (const p of plantingRows.results ?? []) {
    const key = p.bed_id ?? (p.location ? `loc:${p.location}` : null);
    if (!key || sudahAda.has(key)) continue;
    belumDiukur.set(key, p.bed_id ? (bedNames.get(p.bed_id) ?? 'Bedengan') : (p.location ?? 'Lokasi'));
  }

  return c.json({
    profil: (profilRows.results ?? []).map((r) => ({
      lokasiId: r.lokasi_id,
      lokasiLabel: r.lokasi_label,
      jamLangsung: r.hours_direct,
      orientation: r.orientation,
      note: r.note,
    })),
    belumDiukur: [...belumDiukur.entries()].map(([lokasiId, lokasiLabel]) => ({ lokasiId, lokasiLabel })),
    peringatan: cariSalahTempat(penanaman, profil),
    kebutuhanJam: KEBUTUHAN_JAM,
    labelSunlight: LABEL_SUNLIGHT,
  });
});

// PUT /api/garden/sun-map — catat berapa jam matahari satu lokasi
extra3.put('/sun-map', async (c) => {
  const user = c.get('user');
  type Body = { lokasiId?: string; lokasiLabel?: string; jamLangsung?: number; orientation?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const lokasiId = body.lokasiId?.trim();
  if (!lokasiId) return c.json({ error: 'lokasiId wajib diisi' }, 400);
  if (typeof body.jamLangsung !== 'number') {
    return c.json({ error: 'jamLangsung wajib berupa angka' }, 400);
  }

  // Bedengan orang lain tidak boleh dapat profil atas nama pengguna ini.
  const { bedId } = bongkarLokasiId(lokasiId);
  if (bedId) {
    const owned = await c.env.DB.prepare('SELECT id FROM garden_beds WHERE id = ?1 AND user_id = ?2')
      .bind(bedId, user.sub).first<{ id: string }>();
    if (!owned) return c.json({ error: 'bedengan tidak ditemukan' }, 404);
  }

  const label = body.lokasiLabel?.trim().slice(0, 60) || (bedId ? 'Bedengan' : lokasiId.slice(4) || 'Lokasi');
  const orientation = ORIENTASI.includes(body.orientation as typeof ORIENTASI[number])
    ? body.orientation!
    : null;

  await c.env.DB.prepare(
    `INSERT INTO garden_sun_profile (user_id, lokasi_id, lokasi_label, hours_direct, orientation, note, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, unixepoch())
     ON CONFLICT(user_id, lokasi_id) DO UPDATE SET
       lokasi_label = ?3, hours_direct = ?4, orientation = ?5, note = ?6, updated_at = unixepoch()`
  ).bind(
    user.sub, lokasiId, label, bersihkanJam(body.jamLangsung), orientation,
    body.note?.trim().slice(0, 200) || null
  ).run();

  return c.json({ ok: true });
});

// DELETE /api/garden/sun-map/:lokasiId
extra3.delete('/sun-map/:lokasiId', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_sun_profile WHERE user_id = ?1 AND lokasi_id = ?2')
    .bind(user.sub, c.req.param('lokasiId')).run();
  return c.json({ ok: true });
});

// GET /api/garden/sun-map/fit?plantId= — di mana tanaman ini sebaiknya ditaruh
extra3.get('/sun-map/fit', async (c) => {
  const user = c.get('user');
  const plantId = c.req.query('plantId')?.trim();
  const plant = plantId ? PLANT_BY_ID.get(plantId) : undefined;
  if (!plant) return c.json({ error: 'tanaman tidak ada di katalog' }, 404);

  const butuh = plant.sunlight as Sunlight;
  const profil = await muatProfil(c.env.DB, user.sub);
  const cocok = lokasiCocokUntuk(butuh, profil);

  return c.json({
    plantId: plant.id,
    name: plant.name,
    butuh,
    butuhLabel: LABEL_SUNLIGHT[butuh],
    rentangJam: KEBUTUHAN_JAM[butuh],
    cocok,
    // Dibedakan tegas dari `cocok: []`: belum mengukur satu pun lokasi bukan
    // jawaban "tidak ada tempat yang cocok" — itu dua keadaan yang berbeda,
    // dan layar harus bisa mengatakannya dengan benar.
    adaProfil: profil.length > 0,
  });
});

// ──────────────────── #2 BENIH SIMPANAN SENDIRI ────────────────────

/**
 * Generasi benih yang menumbuhkan satu penanaman.
 *
 * Rantainya: penanaman → semai yang menghasilkannya → benih simpanan yang
 * dipakai semai itu → generasinya. Null di mana pun sepanjang rantai berarti
 * tanamannya berasal dari benih beli, dan benih yang dipanen darinya jadi
 * generasi pertama.
 */
async function generasiIndukDari(db: D1Database, userId: string, plantingId: string): Promise<number | null> {
  const row = await db.prepare(
    `SELECT ss.generation AS generation
       FROM garden_sowings sw
       JOIN garden_sowing_seed_source src ON src.sowing_id = sw.id
       JOIN garden_saved_seed ss ON ss.id = src.saved_seed_id
      WHERE sw.planting_id = ?1 AND sw.user_id = ?2
      ORDER BY ss.generation DESC LIMIT 1`
  ).bind(plantingId, userId).first<{ generation: number }>();
  return row?.generation ?? null;
}

// GET /api/garden/saved-seeds — benih simpanan + ringkasan galur
extra3.get('/saved-seeds', async (c) => {
  const user = c.get('user');

  const [seedRows, hasilRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.id, s.plant_id, s.custom_name, s.generation, s.harvested_date,
              s.quantity, s.unit, s.note, s.source_planting_id,
              p.nickname AS source_nickname
         FROM garden_saved_seed s
         LEFT JOIN garden_plantings p ON p.id = s.source_planting_id
        WHERE s.user_id = ?1
        ORDER BY s.harvested_date DESC, s.created_at DESC`
    ).bind(user.sub).all<{
      id: string; plant_id: string | null; custom_name: string | null; generation: number;
      harvested_date: string; quantity: number; unit: string; note: string | null;
      source_planting_id: string | null; source_nickname: string | null;
    }>(),
    // Panen dari tanaman yang tumbuh DARI benih simpanan — inilah yang
    // membuat silsilahnya berguna, bukan sekadar tercatat.
    c.env.DB.prepare(
      `SELECT ss.id AS saved_seed_id, ss.plant_id, ss.custom_name, ss.generation,
              SUM(l.amount) AS total_panen, MAX(l.unit) AS unit
         FROM garden_saved_seed ss
         JOIN garden_sowing_seed_source src ON src.saved_seed_id = ss.id
         JOIN garden_sowings sw ON sw.id = src.sowing_id
         JOIN garden_care_log l ON l.planting_id = sw.planting_id
              AND l.action = 'panen' AND l.amount IS NOT NULL
        WHERE ss.user_id = ?1
        GROUP BY sw.planting_id, ss.id`
    ).bind(user.sub).all<{
      saved_seed_id: string; plant_id: string | null; custom_name: string | null;
      generation: number; total_panen: number | null; unit: string | null;
    }>(),
  ]);

  const namaDari = (plantId: string | null, customName: string | null) =>
    (plantId ? PLANT_BY_ID.get(plantId)?.name : null) ?? customName ?? 'Tanaman';

  const benih: BenihSimpanan[] = (seedRows.results ?? []).map((r) => ({
    id: r.id,
    plantKey: priceKey(r.plant_id, r.custom_name),
    label: namaDari(r.plant_id, r.custom_name),
    generation: r.generation,
    harvestedDate: r.harvested_date,
  }));

  const hasil: HasilGalur[] = (hasilRows.results ?? []).map((r) => ({
    savedSeedId: r.saved_seed_id,
    plantKey: priceKey(r.plant_id, r.custom_name),
    generation: r.generation,
    totalPanen: r.total_panen,
    unit: r.unit ?? 'kg',
  }));

  return c.json({
    seeds: (seedRows.results ?? []).map((r) => ({
      id: r.id,
      plantId: r.plant_id,
      name: namaDari(r.plant_id, r.custom_name),
      emoji: (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.emoji : null) ?? '🌱',
      generation: r.generation,
      generationLabel: labelGenerasi(r.generation),
      harvestedDate: r.harvested_date,
      quantity: r.quantity,
      unit: r.unit,
      note: r.note,
      sourcePlantingId: r.source_planting_id,
      sourceNickname: r.source_nickname,
    })),
    galur: ringkasGalur(benih, hasil),
  });
});

// POST /api/garden/saved-seeds — simpan benih dari satu tanaman
extra3.post('/saved-seeds', async (c) => {
  const user = c.get('user');
  type Body = { plantingId?: string; harvestedDate?: string; quantity?: number; unit?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const plantingId = body.plantingId?.trim();
  if (!plantingId) return c.json({ error: 'plantingId wajib diisi' }, 400);

  const planting = await c.env.DB.prepare(
    'SELECT id, plant_id, custom_name FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, user.sub).first<{ id: string; plant_id: string | null; custom_name: string | null }>();
  if (!planting) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const generation = generasiBerikutnya(await generasiIndukDari(c.env.DB, user.sub, plantingId));
  const harvestedDate = body.harvestedDate && /^\d{4}-\d{2}-\d{2}$/.test(body.harvestedDate)
    ? body.harvestedDate
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_saved_seed
       (id, user_id, source_planting_id, plant_id, custom_name, generation, harvested_date, quantity, unit, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    id, user.sub, plantingId, planting.plant_id, planting.custom_name, generation, harvestedDate,
    typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 0,
    body.unit?.trim().slice(0, 20) || 'butir',
    body.note?.trim().slice(0, 200) || null
  ).run();

  return c.json({ id, generation, generationLabel: labelGenerasi(generation), ok: true }, 201);
});

// POST /api/garden/saved-seeds/:id/sow — tandai satu semai berasal dari benih ini
extra3.post('/saved-seeds/:id/sow', async (c) => {
  const user = c.get('user');
  const savedSeedId = c.req.param('id');
  type Body = { sowingId?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const sowingId = body.sowingId?.trim();
  if (!sowingId) return c.json({ error: 'sowingId wajib diisi' }, 400);

  const [seed, sowing] = await Promise.all([
    c.env.DB.prepare('SELECT id FROM garden_saved_seed WHERE id = ?1 AND user_id = ?2')
      .bind(savedSeedId, user.sub).first<{ id: string }>(),
    c.env.DB.prepare('SELECT id FROM garden_sowings WHERE id = ?1 AND user_id = ?2')
      .bind(sowingId, user.sub).first<{ id: string }>(),
  ]);
  if (!seed) return c.json({ error: 'benih tidak ditemukan' }, 404);
  if (!sowing) return c.json({ error: 'catatan semai tidak ditemukan' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO garden_sowing_seed_source (sowing_id, saved_seed_id, user_id)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(sowing_id) DO UPDATE SET saved_seed_id = ?2`
  ).bind(sowingId, savedSeedId, user.sub).run();

  return c.json({ ok: true });
});

// DELETE /api/garden/saved-seeds/:id
extra3.delete('/saved-seeds/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_saved_seed WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

export default extra3;
