/**
 * Perluasan modul kebun: pendamping, ekonomi, hama, cuaca, kalender musim,
 * tanam bergilir, foto, benih, dan perencana ruang.
 *
 * Terpisah dari garden.ts yang sudah panjang. Keduanya di-mount pada prefix
 * yang sama, jadi bagi klien tetap satu API.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { PLANTS, PLANT_BY_ID } from '../data/plants';
import { companionAdvice, findGardenConflicts } from '../lib/garden_companion';
import { plantingCalendar, seasonOfMonth } from '../lib/garden_season';
import { fitInArea, fitInBed, potFit } from '../lib/garden_space';
import { getRain, shouldSkipWatering, wateringNote } from '../lib/garden_weather';
import { summarizeEconomics } from '../lib/garden_economics';
import { findSuccessionDue, type ActivePlanting } from '../lib/garden_succession';
import { computeCareState, lastActions, resolvePlants, type PlantingRow } from './garden';

const extra = new Hono<AuthContext>();
extra.use('/*', requireAuth);

const COST_KINDS = ['benih', 'pupuk', 'media', 'pot', 'pestisida', 'lainnya'];
const SEVERITIES = ['ringan', 'sedang', 'berat'];

/** Batas ukuran foto setelah dikompresi klien. */
const MAX_PHOTO_BYTES = 700_000;

/** Id tanaman yang sedang tumbuh di kebun pengguna. */
async function plantedIds(db: D1Database, userId: string): Promise<Set<string>> {
  const rows = await db.prepare(
    "SELECT DISTINCT plant_id FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh','panen') AND plant_id IS NOT NULL"
  ).bind(userId).all<{ plant_id: string }>();
  return new Set((rows.results ?? []).map((r) => r.plant_id));
}

// ─────────────────────────── #1 PENDAMPING ───────────────────────────

// GET /api/garden/companions?plantId= — saran pendamping untuk satu tanaman
extra.get('/companions', async (c) => {
  const user = c.get('user');
  const plantId = c.req.query('plantId');
  if (!plantId) return c.json({ error: 'plantId wajib diisi' }, 400);

  const plant = PLANT_BY_ID.get(plantId);
  if (!plant) return c.json({ error: 'tanaman tidak ada di katalog' }, 404);

  return c.json(companionAdvice(plant, PLANTS, await plantedIds(c.env.DB, user.sub)));
});

// GET /api/garden/conflicts — pasangan bertentangan yang sedang ditanam
extra.get('/conflicts', async (c) => {
  const user = c.get('user');
  const ids = await plantedIds(c.env.DB, user.sub);
  const planted = [...ids].map((id) => PLANT_BY_ID.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  return c.json({ conflicts: findGardenConflicts(planted, PLANTS) });
});

// ─────────────────────── #6 KALENDER MUSIM ───────────────────────

// GET /api/garden/calendar?month= — apa yang bagus ditanam bulan ini
extra.get('/calendar', async (c) => {
  const monthParam = Number(c.req.query('month'));
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
    ? monthParam
    : Number(jakartaToday().slice(5, 7));

  return c.json({
    month,
    season: seasonOfMonth(month),
    windows: plantingCalendar(PLANTS, month),
  });
});

// ────────────────────────── #10 RUANG ──────────────────────────

// GET /api/garden/space?plantId=&areaM2= atau &lengthM=&widthM= atau &potLiter=
extra.get('/space', async (c) => {
  const plantId = c.req.query('plantId');
  if (!plantId) return c.json({ error: 'plantId wajib diisi' }, 400);

  const plant = PLANT_BY_ID.get(plantId);
  if (!plant) return c.json({ error: 'tanaman tidak ada di katalog' }, 404);

  const areaM2 = Number(c.req.query('areaM2'));
  const lengthM = Number(c.req.query('lengthM'));
  const widthM = Number(c.req.query('widthM'));
  const potLiter = Number(c.req.query('potLiter'));

  return c.json({
    plantId: plant.id,
    name: plant.name,
    spacingCm: plant.spacingCm,
    potLiter: plant.potLiter,
    bed:
      Number.isFinite(lengthM) && Number.isFinite(widthM) && lengthM > 0 && widthM > 0
        ? fitInBed(plant, lengthM, widthM)
        : Number.isFinite(areaM2) && areaM2 > 0
          ? fitInArea(plant, areaM2)
          : null,
    pot: Number.isFinite(potLiter) && potLiter > 0 ? potFit(plant, potLiter) : null,
  });
});

// ─────────────────────────── #5 CUACA ───────────────────────────

// GET /api/garden/location
extra.get('/location', async (c) => {
  const user = c.get('user');
  const row = await c.env.DB.prepare(
    'SELECT latitude, longitude, label FROM garden_location WHERE user_id = ?1'
  ).bind(user.sub).first<{ latitude: number; longitude: number; label: string | null }>();

  return c.json(row ?? { latitude: null, longitude: null, label: null });
});

// POST /api/garden/location
extra.post('/location', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ latitude?: number; longitude?: number; label?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  const { latitude, longitude } = body;
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
    return c.json({ error: 'latitude harus antara -90 dan 90' }, 400);
  }
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    return c.json({ error: 'longitude harus antara -180 dan 180' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO garden_location (user_id, latitude, longitude, label, updated_at)
    VALUES (?1, ?2, ?3, ?4, unixepoch())
    ON CONFLICT (user_id) DO UPDATE SET
      latitude = excluded.latitude, longitude = excluded.longitude,
      label = excluded.label, updated_at = excluded.updated_at
  `).bind(user.sub, latitude, longitude, body.label?.trim() || null).run();

  return c.json({ latitude, longitude, label: body.label?.trim() || null });
});

// DELETE /api/garden/location — kembali ke belum-terkonfigurasi
extra.delete('/location', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_location WHERE user_id = ?1').bind(user.sub).run();
  return c.json({ ok: true });
});

// GET /api/garden/weather — curah hujan dan putusan siram hari ini
extra.get('/weather', async (c) => {
  const user = c.get('user');
  const loc = await c.env.DB.prepare(
    'SELECT latitude, longitude, label FROM garden_location WHERE user_id = ?1'
  ).bind(user.sub).first<{ latitude: number; longitude: number; label: string | null }>();

  if (!loc) {
    return c.json({
      configured: false,
      message: 'Atur lokasi kebun dulu supaya pengingat siram bisa menyesuaikan cuaca.',
    });
  }

  const rain = await getRain(c.env.DB, loc.latitude, loc.longitude, jakartaToday());
  if (!rain) {
    // Tidak tahu bukan berarti kering. Pemanggil harus tetap menyiram.
    return c.json({
      configured: true,
      available: false,
      label: loc.label,
      message: 'Data cuaca belum bisa diambil. Pengingat siram tetap berjalan seperti biasa.',
    });
  }

  const verdict = shouldSkipWatering(rain);
  return c.json({
    configured: true,
    available: true,
    label: loc.label,
    rain,
    skipWatering: verdict.skip,
    reason: verdict.reason,
    note: wateringNote(rain),
  });
});

// ────────────────────────── #3 EKONOMI ──────────────────────────

// GET /api/garden/costs
extra.get('/costs', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, planting_id, kind, amount_idr, note, cost_date FROM garden_costs WHERE user_id = ?1 ORDER BY cost_date DESC'
  ).bind(user.sub).all();

  return c.json({ costs: rows.results ?? [] });
});

// POST /api/garden/costs
extra.post('/costs', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ plantingId?: string | null; kind?: string; amount?: number; note?: string; date?: string }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  if (!COST_KINDS.includes(body.kind ?? '')) {
    return c.json({ error: `kind harus salah satu dari: ${COST_KINDS.join(', ')}` }, 400);
  }
  if (typeof body.amount !== 'number' || body.amount <= 0) {
    return c.json({ error: 'amount harus lebih dari 0' }, 400);
  }

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO garden_costs (id, user_id, planting_id, kind, amount_idr, note, cost_date)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    id, user.sub, body.plantingId ?? null, body.kind, Math.round(body.amount),
    body.note?.trim() || null, body.date ?? jakartaToday()
  ).run();

  return c.json({ id }, 201);
});

// DELETE /api/garden/costs/:id
extra.delete('/costs/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_costs WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

// POST /api/garden/prices — harga pasar per tanaman
extra.post('/prices', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ plantKey?: string; price?: number; unit?: string }>().catch(() => null);
  if (!body?.plantKey) return c.json({ error: 'plantKey wajib diisi' }, 400);
  if (typeof body.price !== 'number' || body.price <= 0) {
    return c.json({ error: 'price harus lebih dari 0' }, 400);
  }

  await c.env.DB.prepare(`
    INSERT INTO garden_plant_price (user_id, plant_key, price_idr, unit, updated_at)
    VALUES (?1, ?2, ?3, ?4, unixepoch())
    ON CONFLICT (user_id, plant_key) DO UPDATE SET
      price_idr = excluded.price_idr, unit = excluded.unit, updated_at = excluded.updated_at
  `).bind(user.sub, body.plantKey, Math.round(body.price), body.unit?.trim() || 'kg').run();

  return c.json({ plantKey: body.plantKey, price: Math.round(body.price), unit: body.unit ?? 'kg' });
});

// GET /api/garden/economics
extra.get('/economics', async (c) => {
  const user = c.get('user');

  const [plantingRows, costRows, harvestRows, priceRows] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, plant_id, custom_name, nickname FROM garden_plantings WHERE user_id = ?1'
    ).bind(user.sub).all<{ id: string; plant_id: string | null; custom_name: string | null; nickname: string | null }>(),
    c.env.DB.prepare(
      'SELECT planting_id, kind, amount_idr FROM garden_costs WHERE user_id = ?1'
    ).bind(user.sub).all<{ planting_id: string | null; kind: string; amount_idr: number }>(),
    c.env.DB.prepare(
      "SELECT planting_id, amount, unit FROM garden_care_log WHERE user_id = ?1 AND action = 'panen' AND amount IS NOT NULL"
    ).bind(user.sub).all<{ planting_id: string; amount: number; unit: string | null }>(),
    c.env.DB.prepare(
      'SELECT plant_key, price_idr, unit FROM garden_plant_price WHERE user_id = ?1'
    ).bind(user.sub).all<{ plant_key: string; price_idr: number; unit: string }>(),
  ]);

  const labels = new Map<string, { label: string; plantKey: string }>();
  for (const row of plantingRows.results ?? []) {
    const plant = row.plant_id ? PLANT_BY_ID.get(row.plant_id) : undefined;
    labels.set(row.id, {
      label: row.nickname || plant?.name || row.custom_name || 'Tanaman',
      plantKey: row.plant_id ?? (row.custom_name ?? '').toLowerCase(),
    });
  }

  const summary = summarizeEconomics(
    labels,
    (costRows.results ?? []).map((r) => ({ plantingId: r.planting_id, kind: r.kind, amount: r.amount_idr })),
    (harvestRows.results ?? []).map((r) => ({
      plantingId: r.planting_id,
      plantKey: labels.get(r.planting_id)?.plantKey ?? '',
      amount: r.amount,
      unit: r.unit ?? 'kg',
    })),
    (priceRows.results ?? []).map((r) => ({ plantKey: r.plant_key, price: r.price_idr, unit: r.unit }))
  );

  return c.json(summary);
});

// ──────────────────────────── #4 HAMA ────────────────────────────

// GET /api/garden/pests
extra.get('/pests', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(`
    SELECT p.id, p.planting_id, p.pest, p.severity, p.treatment, p.spotted_date,
           p.resolved_date, p.worked, g.nickname, g.plant_id, g.custom_name
    FROM garden_pest_log p
    JOIN garden_plantings g ON g.id = p.planting_id
    WHERE p.user_id = ?1
    ORDER BY p.spotted_date DESC
  `).bind(user.sub).all<{
    id: string; planting_id: string; pest: string; severity: string; treatment: string | null;
    spotted_date: string; resolved_date: string | null; worked: number | null;
    nickname: string | null; plant_id: string | null; custom_name: string | null;
  }>();

  const incidents = (rows.results ?? []).map((row) => ({
    id: row.id,
    plantingId: row.planting_id,
    plantLabel: row.nickname || (row.plant_id ? PLANT_BY_ID.get(row.plant_id)?.name : null) || row.custom_name || 'Tanaman',
    pest: row.pest,
    severity: row.severity,
    treatment: row.treatment,
    spottedDate: row.spotted_date,
    resolvedDate: row.resolved_date,
    worked: row.worked === null ? null : row.worked === 1,
  }));

  // Tindakan yang terbukti berhasil, supaya musim depan tidak mengulang
  // percobaan yang sudah gagal.
  const effective = new Map<string, { treatment: string; times: number }>();
  for (const incident of incidents) {
    if (incident.worked !== true || !incident.treatment) continue;
    const key = `${incident.pest.toLowerCase()}|${incident.treatment.toLowerCase()}`;
    const current = effective.get(key);
    effective.set(key, { treatment: incident.treatment, times: (current?.times ?? 0) + 1 });
  }

  return c.json({
    incidents,
    provenTreatments: [...effective.entries()].map(([key, v]) => ({
      pest: key.split('|')[0],
      treatment: v.treatment,
      times: v.times,
    })),
  });
});

// POST /api/garden/pests
extra.post('/pests', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ plantingId?: string; pest?: string; severity?: string; treatment?: string; date?: string }>()
    .catch(() => null);
  if (!body?.plantingId || !body.pest?.trim()) {
    return c.json({ error: 'plantingId dan pest wajib diisi' }, 400);
  }
  if (body.severity && !SEVERITIES.includes(body.severity)) {
    return c.json({ error: `severity harus salah satu dari: ${SEVERITIES.join(', ')}` }, 400);
  }

  const owned = await c.env.DB.prepare(
    'SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(body.plantingId, user.sub).first();
  if (!owned) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO garden_pest_log (id, user_id, planting_id, pest, severity, treatment, spotted_date)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
  `).bind(
    id, user.sub, body.plantingId, body.pest.trim(), body.severity ?? 'sedang',
    body.treatment?.trim() || null, body.date ?? jakartaToday()
  ).run();

  return c.json({ id }, 201);
});

// PATCH /api/garden/pests/:id — tandai teratasi dan apakah tindakannya berhasil
extra.patch('/pests/:id', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ worked?: boolean; treatment?: string; resolvedDate?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  await c.env.DB.prepare(`
    UPDATE garden_pest_log
    SET worked = COALESCE(?1, worked),
        treatment = COALESCE(?2, treatment),
        resolved_date = COALESCE(?3, resolved_date)
    WHERE id = ?4 AND user_id = ?5
  `).bind(
    body.worked === undefined ? null : (body.worked ? 1 : 0),
    body.treatment?.trim() || null,
    body.resolvedDate ?? (body.worked !== undefined ? jakartaToday() : null),
    c.req.param('id'), user.sub
  ).run();

  return c.json({ ok: true });
});

// ─────────────────────── #7 TANAM BERGILIR ───────────────────────

// GET /api/garden/succession
extra.get('/succession', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = await c.env.DB.prepare(
    `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
            planted_date, expected_harvest_date, status, note
     FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh','panen')`
  ).bind(user.sub).all<PlantingRow>();

  const plantings = rows.results ?? [];
  const [plantMap, lastMap] = await Promise.all([
    resolvePlants(c.env.DB, [...new Set(plantings.map((p) => p.plant_id).filter((id): id is string => !!id))]),
    lastActions(c.env.DB, user.sub),
  ]);

  const active: ActivePlanting[] = plantings.map((p) => {
    const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
    const care = computeCareState(p, plant, lastMap.get(p.id) ?? {}, today);
    return {
      id: p.id,
      plantId: p.plant_id,
      label: p.nickname || plant?.name || p.custom_name || 'Tanaman',
      nextHarvest: care.nextHarvest,
    };
  });

  return c.json({ due: findSuccessionDue(active, PLANT_BY_ID, today, 7) });
});

// ──────────────────────────── #8 FOTO ────────────────────────────

// GET /api/garden/:id/photos
extra.get('/:id/photos', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    'SELECT id, image, taken_date, note FROM garden_photos WHERE planting_id = ?1 AND user_id = ?2 ORDER BY taken_date DESC'
  ).bind(c.req.param('id'), user.sub).all();

  return c.json({ photos: rows.results ?? [] });
});

// POST /api/garden/:id/photos
extra.post('/:id/photos', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('id');
  const body = await c.req.json<{ image?: string; date?: string; note?: string }>().catch(() => null);

  if (!body?.image?.startsWith('data:image/')) {
    return c.json({ error: 'image harus data URL gambar' }, 400);
  }
  // Foto disimpan di D1 (R2 belum aktif di akun ini), jadi ukurannya dibatasi
  // supaya satu baris tidak membengkak. Klien sudah mengompresi sebelum kirim.
  if (body.image.length > MAX_PHOTO_BYTES) {
    return c.json({ error: 'Foto terlalu besar. Coba ambil ulang dengan resolusi lebih kecil.' }, 413);
  }

  const owned = await c.env.DB.prepare(
    'SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, user.sub).first();
  if (!owned) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const id = nanoid();
  await c.env.DB.prepare(
    'INSERT INTO garden_photos (id, user_id, planting_id, image, taken_date, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(id, user.sub, plantingId, body.image, body.date ?? jakartaToday(), body.note?.trim() || null).run();

  return c.json({ id }, 201);
});

// DELETE /api/garden/photos/:photoId
extra.delete('/photos/:photoId', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_photos WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('photoId'), user.sub).run();
  return c.json({ ok: true });
});

// ─────────────────────────── #9 BENIH ───────────────────────────

// GET /api/garden/seeds
extra.get('/seeds', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = await c.env.DB.prepare(
    'SELECT id, plant_id, name, quantity, unit, purchase_date, expiry_date, note FROM garden_seeds WHERE user_id = ?1 ORDER BY COALESCE(expiry_date, \'9999-12-31\') ASC'
  ).bind(user.sub).all<{
    id: string; plant_id: string | null; name: string; quantity: number; unit: string;
    purchase_date: string | null; expiry_date: string | null; note: string | null;
  }>();

  const seeds = (rows.results ?? []).map((row) => {
    const daysLeft = row.expiry_date
      ? Math.round((new Date(`${row.expiry_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000)
      : null;
    return {
      ...row,
      daysLeft,
      // Benih kedaluwarsa masih bisa tumbuh, hanya daya tumbuhnya turun —
      // jadi ditandai, bukan disembunyikan.
      status: daysLeft === null ? 'tanpa-tanggal' : daysLeft < 0 ? 'kedaluwarsa' : daysLeft <= 60 ? 'segera' : 'aman',
    };
  });

  return c.json({ seeds });
});

// POST /api/garden/seeds
extra.post('/seeds', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ plantId?: string; name?: string; quantity?: number; unit?: string; purchaseDate?: string; expiryDate?: string; note?: string }>()
    .catch(() => null);
  if (!body?.name?.trim()) return c.json({ error: 'name wajib diisi' }, 400);

  const id = nanoid();
  await c.env.DB.prepare(`
    INSERT INTO garden_seeds (id, user_id, plant_id, name, quantity, unit, purchase_date, expiry_date, note)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  `).bind(
    id, user.sub,
    body.plantId && PLANT_BY_ID.has(body.plantId) ? body.plantId : null,
    body.name.trim(),
    typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1,
    body.unit?.trim() || 'bungkus',
    body.purchaseDate ?? null, body.expiryDate ?? null, body.note?.trim() || null
  ).run();

  return c.json({ id }, 201);
});

// PUT /api/garden/seeds/:id
extra.put('/seeds/:id', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ name?: string; quantity?: number; unit?: string; expiryDate?: string; note?: string }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'body tidak valid' }, 400);

  await c.env.DB.prepare(`
    UPDATE garden_seeds
    SET name = COALESCE(?1, name), quantity = COALESCE(?2, quantity),
        unit = COALESCE(?3, unit), expiry_date = COALESCE(?4, expiry_date),
        note = COALESCE(?5, note)
    WHERE id = ?6 AND user_id = ?7
  `).bind(
    body.name?.trim() || null,
    typeof body.quantity === 'number' ? body.quantity : null,
    body.unit?.trim() || null,
    body.expiryDate ?? null,
    body.note?.trim() || null,
    c.req.param('id'), user.sub
  ).run();

  return c.json({ ok: true });
});

// DELETE /api/garden/seeds/:id
extra.delete('/seeds/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_seeds WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

export default extra;
