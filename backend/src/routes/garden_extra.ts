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
import { getRain, getWaterBalance, shouldSkipWatering, wateringNote } from '../lib/garden_weather';
import { loadSettings, num } from '../lib/settings';
import { summarizeEconomics, computeBreakEven, type YearlyTotal } from '../lib/garden_economics';
import { findSuccessionDue, type ActivePlanting } from '../lib/garden_succession';
import { predictYield, type HarvestSample } from '../lib/garden_yield';
import { findFailurePatterns, type FailedPlanting } from '../lib/garden_failure_patterns';
import { checkRotation, type LocationPlanting } from '../lib/garden_rotation';
import { assessPestRisk, findAtRiskPlantings, type RiskCandidate } from '../lib/garden_pest_risk';
import { planBedLayout, type BedCandidate } from '../lib/garden_layout';
import { computeCareState, lastActions, resolvePlants, type PlantingRow } from './garden';
import {
  rankSeedSources, summarizeSowings, type SowingStatusRecord,
} from '../lib/garden_germination';
import { forecastHarvest, expectedCareCount } from '../lib/garden_harvest_forecast';
import { planSupplies, type SupplyPlanting } from '../lib/garden_supplies';
import { rankTreatments, pendingReviews, type TreatmentRecord } from '../lib/garden_treatment';
import { inspectBed, suggestSlot, type Bed, type BedSlot } from '../lib/garden_bed_map';
import { buildKitchenReport, priceKey, type HarvestEntry } from '../lib/garden_kitchen';

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

  const settings = await loadSettings(c.env.DB, user.sub);
  const skipMm = num(settings, 'garden.rain_skip_mm');
  const verdict = shouldSkipWatering(rain, { skipMm, soakedMm: num(settings, 'garden.rain_soaked_mm') });
  // Cache dari getRain di atas biasanya masih hangat di sini, jadi ini
  // umumnya tinggal baca cache, bukan panggilan jaringan kedua.
  const waterBalance = await getWaterBalance(c.env.DB, loc.latitude, loc.longitude, jakartaToday());

  return c.json({
    configured: true,
    available: true,
    label: loc.label,
    rain,
    waterBalance,
    skipWatering: verdict.skip,
    reason: verdict.reason,
    note: wateringNote(rain, skipMm),
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

// GET /api/garden/economics/yearly — apakah kebun ini sudah balik modal
extra.get('/economics/yearly', async (c) => {
  const user = c.get('user');

  const [plantingRows, costRows, harvestRows, priceRows] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, plant_id, custom_name FROM garden_plantings WHERE user_id = ?1'
    ).bind(user.sub).all<{ id: string; plant_id: string | null; custom_name: string | null }>(),
    c.env.DB.prepare(
      'SELECT amount_idr, cost_date FROM garden_costs WHERE user_id = ?1'
    ).bind(user.sub).all<{ amount_idr: number; cost_date: string }>(),
    c.env.DB.prepare(
      "SELECT planting_id, amount, unit, action_date FROM garden_care_log WHERE user_id = ?1 AND action = 'panen' AND amount IS NOT NULL"
    ).bind(user.sub).all<{ planting_id: string; amount: number; unit: string | null; action_date: string }>(),
    c.env.DB.prepare(
      'SELECT plant_key, price_idr, unit FROM garden_plant_price WHERE user_id = ?1'
    ).bind(user.sub).all<{ plant_key: string; price_idr: number; unit: string }>(),
  ]);

  const plantKeyByPlanting = new Map<string, string>();
  for (const row of plantingRows.results ?? []) {
    plantKeyByPlanting.set(row.id, row.plant_id ?? (row.custom_name ?? '').toLowerCase());
  }
  const priceByKey = new Map((priceRows.results ?? []).map((r) => [r.plant_key, r]));

  const byYear = new Map<number, { cost: number; value: number }>();
  const bump = (year: number, delta: { cost?: number; value?: number }) => {
    const entry = byYear.get(year) ?? { cost: 0, value: 0 };
    entry.cost += delta.cost ?? 0;
    entry.value += delta.value ?? 0;
    byYear.set(year, entry);
  };

  for (const row of costRows.results ?? []) {
    const year = Number(row.cost_date.slice(0, 4));
    if (Number.isInteger(year)) bump(year, { cost: row.amount_idr });
  }

  // Sama seperti /economics: harga yang belum diisi tidak ditebak, jadi
  // panennya tidak ikut menyumbang nilai tahun itu sampai harganya diisi.
  for (const row of harvestRows.results ?? []) {
    const plantKey = plantKeyByPlanting.get(row.planting_id);
    const price = plantKey ? priceByKey.get(plantKey) : undefined;
    if (!price || price.unit !== (row.unit ?? 'kg')) continue;

    const year = Number(row.action_date.slice(0, 4));
    if (Number.isInteger(year)) bump(year, { value: Math.round(row.amount * price.price_idr) });
  }

  const totals: YearlyTotal[] = [...byYear.entries()].map(([year, t]) => ({ year, cost: t.cost, value: t.value }));
  return c.json(computeBreakEven(totals));
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

// ────────────────── #11 PREDIKSI PANEN ──────────────────

// GET /api/garden/yield-prediction — perkiraan hasil panen berikutnya dari riwayat sendiri
extra.get('/yield-prediction', async (c) => {
  const user = c.get('user');

  const [plantingRows, harvestRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plant_id, nickname, custom_name FROM garden_plantings
       WHERE user_id = ?1 AND status IN ('tumbuh','panen') AND plant_id IS NOT NULL`
    ).bind(user.sub).all<{ id: string; plant_id: string; nickname: string | null; custom_name: string | null }>(),
    c.env.DB.prepare(`
      SELECT gp.plant_id AS plant_id, l.amount AS amount, l.unit AS unit, l.action_date AS action_date
      FROM garden_care_log l
      JOIN garden_plantings gp ON gp.id = l.planting_id
      WHERE l.user_id = ?1 AND l.action = 'panen' AND l.amount IS NOT NULL AND gp.plant_id IS NOT NULL
    `).bind(user.sub).all<{ plant_id: string; amount: number; unit: string | null; action_date: string }>(),
  ]);

  const historyByPlant = new Map<string, HarvestSample[]>();
  for (const row of harvestRows.results ?? []) {
    const list = historyByPlant.get(row.plant_id) ?? [];
    list.push({ amount: row.amount, unit: row.unit ?? 'kg', date: row.action_date });
    historyByPlant.set(row.plant_id, list);
  }

  const predictions: Array<{
    plantingId: string; name: string; emoji: string; plantId: string;
    predictedAmount: number; unit: string; confidence: string; sampleSize: number; excludedByUnit: number;
  }> = [];

  for (const p of plantingRows.results ?? []) {
    const prediction = predictYield(p.plant_id, historyByPlant.get(p.plant_id) ?? []);
    if (!prediction) continue;
    const plant = PLANT_BY_ID.get(p.plant_id);
    predictions.push({
      plantingId: p.id,
      name: p.nickname || plant?.name || p.custom_name || 'Tanaman',
      emoji: plant?.emoji ?? '🌱',
      ...prediction,
    });
  }

  return c.json({ predictions });
});

// ────────────────── #12 POLA GAGAL PANEN ──────────────────

// GET /api/garden/failure-patterns — kegagalan berulang, disilangkan dengan lokasi/musim/hama
extra.get('/failure-patterns', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    `SELECT id, plant_id, nickname, custom_name, location, planted_date
     FROM garden_plantings WHERE user_id = ?1 AND status = 'gagal' AND plant_id IS NOT NULL`
  ).bind(user.sub).all<{
    id: string; plant_id: string; nickname: string | null; custom_name: string | null;
    location: string | null; planted_date: string;
  }>();

  const failedRows = rows.results ?? [];
  if (failedRows.length === 0) return c.json({ patterns: [] });

  const ids = failedRows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const pestRows = await c.env.DB.prepare(
    `SELECT DISTINCT planting_id FROM garden_pest_log WHERE planting_id IN (${placeholders})`
  ).bind(...ids).all<{ planting_id: string }>();
  const withPest = new Set((pestRows.results ?? []).map((r) => r.planting_id));

  const failures: FailedPlanting[] = failedRows.map((r) => {
    const plant = PLANT_BY_ID.get(r.plant_id);
    return {
      plantingId: r.id,
      plantId: r.plant_id,
      label: plant?.name ?? r.nickname ?? r.custom_name ?? 'Tanaman',
      location: r.location,
      month: Number(r.planted_date.slice(5, 7)),
      hadPestIncident: withPest.has(r.id),
    };
  });

  return c.json({ patterns: findFailurePatterns(failures) });
});

// ────────────────── #13 ROTASI TANAM ──────────────────

// GET /api/garden/rotation-check — famili sama berturut-turut di lokasi sama
extra.get('/rotation-check', async (c) => {
  const user = c.get('user');

  const rows = await c.env.DB.prepare(
    `SELECT id, plant_id, nickname, custom_name, location, planted_date
     FROM garden_plantings
     WHERE user_id = ?1 AND plant_id IS NOT NULL AND location IS NOT NULL AND location != ''`
  ).bind(user.sub).all<{
    id: string; plant_id: string; nickname: string | null; custom_name: string | null;
    location: string; planted_date: string;
  }>();

  const history: LocationPlanting[] = (rows.results ?? []).map((r) => {
    const plant = PLANT_BY_ID.get(r.plant_id);
    return {
      plantingId: r.id,
      plantId: r.plant_id,
      label: plant?.name ?? r.nickname ?? r.custom_name ?? 'Tanaman',
      location: r.location,
      plantedDate: r.planted_date,
    };
  });

  return c.json({ warnings: checkRotation(history) });
});

// ────────────────── #16 RISIKO HAMA DARI CUACA ──────────────────

// GET /api/garden/pest-risk — peringatan dini dari pola hujan 3 hari
extra.get('/pest-risk', async (c) => {
  const user = c.get('user');
  const empty = { condition: null as string | null, reason: '', warnings: [] as unknown[] };

  const loc = await c.env.DB.prepare(
    'SELECT latitude, longitude FROM garden_location WHERE user_id = ?1'
  ).bind(user.sub).first<{ latitude: number; longitude: number }>();
  if (!loc) return c.json(empty);

  const rain = await getRain(c.env.DB, loc.latitude, loc.longitude, jakartaToday());
  if (!rain) return c.json(empty);

  const assessment = assessPestRisk(rain);
  if (!assessment.condition) return c.json(empty);

  const [plantingRows, pestRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plant_id, nickname, custom_name FROM garden_plantings
       WHERE user_id = ?1 AND status IN ('tumbuh','panen') AND plant_id IS NOT NULL`
    ).bind(user.sub).all<{ id: string; plant_id: string; nickname: string | null; custom_name: string | null }>(),
    c.env.DB.prepare(
      'SELECT planting_id, pest FROM garden_pest_log WHERE user_id = ?1'
    ).bind(user.sub).all<{ planting_id: string; pest: string }>(),
  ]);

  const pestHistoryByPlanting = new Map<string, string[]>();
  for (const row of pestRows.results ?? []) {
    const list = pestHistoryByPlanting.get(row.planting_id) ?? [];
    list.push(row.pest);
    pestHistoryByPlanting.set(row.planting_id, list);
  }

  const candidates: RiskCandidate[] = (plantingRows.results ?? []).map((p) => {
    const plant = PLANT_BY_ID.get(p.plant_id);
    return {
      plantingId: p.id,
      label: plant?.name ?? p.nickname ?? p.custom_name ?? 'Tanaman',
      catalogPests: plant?.pests ?? [],
      ownHistoryPests: pestHistoryByPlanting.get(p.id) ?? [],
    };
  });

  return c.json({
    condition: assessment.condition,
    reason: assessment.reason,
    warnings: findAtRiskPlantings(assessment.keywords, candidates),
  });
});

// ────────────────── #17 SUSUN-TANAM ──────────────────

// POST /api/garden/layout — { candidates: [{plantId, quantity}], bedAreaM2? }
extra.post('/layout', async (c) => {
  const body = await c.req
    .json<{ candidates?: Array<{ plantId?: string; quantity?: number }>; bedAreaM2?: number }>()
    .catch(() => null);
  if (!body?.candidates?.length) return c.json({ error: 'candidates wajib diisi' }, 400);

  const candidates: BedCandidate[] = body.candidates
    .filter((entry): entry is { plantId: string; quantity?: number } => typeof entry.plantId === 'string')
    .map((entry) => ({
      plantId: entry.plantId,
      quantity: typeof entry.quantity === 'number' && entry.quantity > 0 ? Math.round(entry.quantity) : 1,
    }));
  if (candidates.length === 0) return c.json({ error: 'candidates wajib diisi' }, 400);

  const bedAreaM2 = typeof body.bedAreaM2 === 'number' && body.bedAreaM2 > 0 ? body.bedAreaM2 : null;

  return c.json(planBedLayout(candidates, PLANTS, bedAreaM2));
});

// ────────────────────── #13 PEMBIBITAN (SEMAI) ──────────────────────

/** Baris semai apa adanya dari DB, sebelum dibentuk untuk lib. */
interface SowingRow {
  id: string;
  plant_id: string | null;
  name: string;
  seed_brand: string | null;
  sown_date: string;
  seed_count: number;
  germinated_count: number | null;
  germinated_date: string | null;
  transplanted_date: string | null;
  planting_id: string | null;
  note: string | null;
}

function toSowingRecord(r: SowingRow): SowingStatusRecord {
  return {
    id: r.id,
    plantId: r.plant_id,
    name: r.name,
    brand: r.seed_brand,
    sownDate: r.sown_date,
    seedCount: r.seed_count,
    germinatedCount: r.germinated_count,
    transplantedDate: r.transplanted_date,
  };
}

// GET /api/garden/sowings — daftar batch semai + ringkasan + peringkat merek
extra.get('/sowings', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT id, plant_id, name, seed_brand, sown_date, seed_count, germinated_count,
            germinated_date, transplanted_date, planting_id, note
       FROM garden_sowings WHERE user_id = ?1 ORDER BY sown_date DESC LIMIT 200`
  ).bind(user.sub).all<SowingRow>();

  const list = rows.results ?? [];
  const records = list.map(toSowingRecord);

  return c.json({
    sowings: list.map((r) => ({
      id: r.id,
      plantId: r.plant_id,
      name: r.name,
      emoji: (r.plant_id ? PLANT_BY_ID.get(r.plant_id)?.emoji : undefined) ?? '🌱',
      brand: r.seed_brand,
      sownDate: r.sown_date,
      seedCount: r.seed_count,
      germinatedCount: r.germinated_count,
      germinatedDate: r.germinated_date,
      transplantedDate: r.transplanted_date,
      plantingId: r.planting_id,
      note: r.note,
    })),
    summary: summarizeSowings(records),
    sources: rankSeedSources(records),
  });
});

// POST /api/garden/sowings — catat batch semai baru
extra.post('/sowings', async (c) => {
  const user = c.get('user');
  type Body = {
    plantId?: string; name?: string; brand?: string;
    sownDate?: string; seedCount?: number; note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const name = body.name?.trim();
  if (!name) return c.json({ error: 'nama tanaman wajib diisi' }, 400);

  const seedCount = Math.floor(body.seedCount ?? 0);
  if (!Number.isFinite(seedCount) || seedCount <= 0) {
    return c.json({ error: 'jumlah benih harus lebih dari nol' }, 400);
  }

  const sownDate = body.sownDate && /^\d{4}-\d{2}-\d{2}$/.test(body.sownDate)
    ? body.sownDate
    : jakartaToday();

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO garden_sowings (id, user_id, plant_id, name, seed_brand, sown_date, seed_count, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    id, user.sub, body.plantId?.trim() || null, name,
    body.brand?.trim() || null, sownDate, seedCount, body.note?.trim() || null
  ).run();

  return c.json({ id, ok: true });
});

// PATCH /api/garden/sowings/:id — catat hasil kecambah atau pindah tanam
extra.patch('/sowings/:id', async (c) => {
  const user = c.get('user');
  type Body = { germinatedCount?: number; transplantedDate?: string; plantingId?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  // Nol adalah jawaban sah — gagal total justru data terpenting — jadi yang
  // dicek keberadaan field-nya, bukan kebenarannya sebagai angka.
  let germinated: number | null = null;
  if (body.germinatedCount !== undefined) {
    germinated = Math.floor(body.germinatedCount);
    if (!Number.isFinite(germinated) || germinated < 0) {
      return c.json({ error: 'jumlah kecambah tidak valid' }, 400);
    }
  }

  const res = await c.env.DB.prepare(
    `UPDATE garden_sowings
        SET germinated_count = COALESCE(?1, germinated_count),
            germinated_date  = CASE WHEN ?1 IS NOT NULL THEN ?2 ELSE germinated_date END,
            transplanted_date = COALESCE(?3, transplanted_date),
            planting_id      = COALESCE(?4, planting_id),
            note             = COALESCE(?5, note)
      WHERE id = ?6 AND user_id = ?7`
  ).bind(
    germinated, jakartaToday(),
    body.transplantedDate ?? null, body.plantingId ?? null,
    body.note?.trim() || null,
    c.req.param('id'), user.sub
  ).run();

  if (!res.meta.changes) return c.json({ error: 'catatan semai tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/garden/sowings/:id
extra.delete('/sowings/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_sowings WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

// ────────────────── #14 PERKIRAAN PANEN ADAPTIF ──────────────────

// GET /api/garden/harvest-forecast — perkiraan panen dikoreksi kepatuhan perawatan
extra.get('/harvest-forecast', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const [plantingRes, careRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
              planted_date, expected_harvest_date, status, note
         FROM garden_plantings
        WHERE user_id = ?1 AND status = 'tumbuh'`
    ).bind(user.sub).all<PlantingRow>(),
    // Jumlah perawatan nyata per tanaman, satu kueri untuk semua — bukan satu
    // kueri per tanaman di dalam loop.
    c.env.DB.prepare(
      `SELECT planting_id, action, COUNT(*) AS n FROM garden_care_log
        WHERE user_id = ?1 AND action IN ('siram','pupuk')
        GROUP BY planting_id, action`
    ).bind(user.sub).all<{ planting_id: string; action: string; n: number }>(),
  ]);

  const rows = plantingRes.results ?? [];
  const plants = await resolvePlants(
    c.env.DB, rows.map((r) => r.plant_id).filter((id): id is string => !!id)
  );

  const counts = new Map<string, { siram: number; pupuk: number }>();
  for (const r of careRes.results ?? []) {
    const e = counts.get(r.planting_id) ?? { siram: 0, pupuk: 0 };
    if (r.action === 'siram') e.siram = r.n;
    if (r.action === 'pupuk') e.pupuk = r.n;
    counts.set(r.planting_id, e);
  }

  const forecasts = [];
  for (const row of rows) {
    const plant = row.plant_id ? plants.get(row.plant_id) : undefined;
    // Tanpa katalog tidak ada interval maupun umur panen — tidak ada yang bisa
    // dikoreksi, jadi tanaman itu dilewati daripada ditebak.
    if (!plant) continue;

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

    forecasts.push({
      plantingId: row.id,
      name: row.nickname || plant.name || row.custom_name || 'Tanaman',
      emoji: plant.emoji,
      ...forecast,
    });
  }

  // Yang paling dekat panen didahulukan — itu yang perlu disiapkan.
  forecasts.sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate));
  return c.json({ today, forecasts });
});

// ────────────────── #15 KALKULATOR BELANJA KEBUN ──────────────────

// GET /api/garden/supplies — kebutuhan media tanam & pupuk untuk tanaman aktif
extra.get('/supplies', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = (await c.env.DB.prepare(
    `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
            planted_date, expected_harvest_date, status, note
       FROM garden_plantings WHERE user_id = ?1 AND status = 'tumbuh'`
  ).bind(user.sub).all<PlantingRow>()).results ?? [];

  const plants = await resolvePlants(
    c.env.DB, rows.map((r) => r.plant_id).filter((id): id is string => !!id)
  );
  const actions = await lastActions(c.env.DB, user.sub);

  const inputs: SupplyPlanting[] = [];
  for (const row of rows) {
    const plant = row.plant_id ? plants.get(row.plant_id) : undefined;
    if (!plant) continue;

    const care = computeCareState(row, plant, actions.get(row.id) ?? {}, today);
    const daysToHarvest = care.nextHarvest
      ? Math.max(0, Math.round(
          (new Date(`${care.nextHarvest}T00:00:00Z`).getTime()
            - new Date(`${today}T00:00:00Z`).getTime()) / 86400000
        ))
      : 0;

    inputs.push({
      plantingId: row.id,
      name: plant.name,
      quantity: row.quantity,
      potLiter: plant.potLiter,
      fertilizeIntervalDays: plant.fertilizeIntervalDays,
      daysToHarvest,
    });
  }

  return c.json({ needs: planSupplies(inputs), plantingCount: inputs.length });
});

// ──────────────── #16 EFEKTIVITAS PENANGANAN HAMA ────────────────

// GET /api/garden/treatments — peringkat penanganan + catatan yang perlu dinilai
extra.get('/treatments', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const rows = (await c.env.DB.prepare(
    `SELECT id, pest, treatment, worked, spotted_date, resolved_date
       FROM garden_pest_log WHERE user_id = ?1 ORDER BY spotted_date DESC LIMIT 300`
  ).bind(user.sub).all<{
    id: string; pest: string; treatment: string | null;
    worked: number | null; spotted_date: string; resolved_date: string | null;
  }>()).results ?? [];

  const records: TreatmentRecord[] = rows.map((r) => ({
    pest: r.pest,
    treatment: r.treatment,
    worked: r.worked,
    spottedDate: r.spotted_date,
    resolvedDate: r.resolved_date,
  }));

  // Id dibawa kembali supaya frontend bisa langsung PATCH catatan yang ditagih.
  const pendingIds = new Map(rows.filter((r) => r.worked === null).map((r) => [r.spotted_date + r.pest, r.id]));
  const pending = pendingReviews(records, today).map((p) => ({
    ...p,
    id: pendingIds.get(p.spottedDate + p.pest) ?? null,
  }));

  return c.json({ scores: rankTreatments(records), pending });
});

// ──────────────────── #17 DENAH BEDENGAN ────────────────────

// GET /api/garden/beds — daftar bedengan beserta isinya dan masalah tata letak
extra.get('/beds', async (c) => {
  const user = c.get('user');

  const [bedRes, slotRes] = await Promise.all([
    c.env.DB.prepare(
      'SELECT id, name, width_cm, length_cm, note FROM garden_beds WHERE user_id = ?1 ORDER BY created_at'
    ).bind(user.sub).all<{ id: string; name: string; width_cm: number; length_cm: number; note: string | null }>(),
    c.env.DB.prepare(
      `SELECT s.planting_id, s.bed_id, s.pos_x, s.pos_y,
              p.plant_id, p.nickname, p.custom_name
         FROM garden_bed_slots s
         JOIN garden_plantings p ON p.id = s.planting_id
        WHERE s.user_id = ?1`
    ).bind(user.sub).all<{
      planting_id: string; bed_id: string; pos_x: number; pos_y: number;
      plant_id: string | null; nickname: string | null; custom_name: string | null;
    }>(),
  ]);

  const slotRows = slotRes.results ?? [];
  const plants = await resolvePlants(
    c.env.DB, slotRows.map((s) => s.plant_id).filter((id): id is string => !!id)
  );

  const byBed = new Map<string, BedSlot[]>();
  for (const s of slotRows) {
    const plant = s.plant_id ? plants.get(s.plant_id) : undefined;
    const list = byBed.get(s.bed_id) ?? [];
    list.push({
      plantingId: s.planting_id,
      name: s.nickname || plant?.name || s.custom_name || 'Tanaman',
      posX: s.pos_x,
      posY: s.pos_y,
      spacingCm: plant?.spacingCm ?? 0,
    });
    byBed.set(s.bed_id, list);
  }

  const beds = (bedRes.results ?? []).map((b) => {
    const bed: Bed = { id: b.id, name: b.name, widthCm: b.width_cm, lengthCm: b.length_cm };
    const slots = byBed.get(b.id) ?? [];
    return { ...bed, note: b.note, slots, report: inspectBed(bed, slots) };
  });

  return c.json({ beds });
});

// POST /api/garden/beds — buat bedengan
extra.post('/beds', async (c) => {
  const user = c.get('user');
  type Body = { name?: string; widthCm?: number; lengthCm?: number; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const name = body.name?.trim();
  if (!name) return c.json({ error: 'nama bedengan wajib diisi' }, 400);

  const widthCm = Math.round(body.widthCm ?? 0);
  const lengthCm = Math.round(body.lengthCm ?? 0);
  if (widthCm <= 0 || lengthCm <= 0) return c.json({ error: 'ukuran bedengan harus lebih dari nol' }, 400);
  if (widthCm > 5000 || lengthCm > 5000) return c.json({ error: 'ukuran bedengan terlalu besar' }, 400);

  const id = nanoid();
  await c.env.DB.prepare(
    'INSERT INTO garden_beds (id, user_id, name, width_cm, length_cm, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(id, user.sub, name, widthCm, lengthCm, body.note?.trim() || null).run();

  return c.json({ id, ok: true });
});

// DELETE /api/garden/beds/:id
extra.delete('/beds/:id', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_beds WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('id'), user.sub).run();
  return c.json({ ok: true });
});

// PUT /api/garden/beds/:id/slots — taruh atau pindahkan satu tanaman di denah
extra.put('/beds/:id/slots', async (c) => {
  const user = c.get('user');
  const bedId = c.req.param('id');
  type Body = { plantingId?: string; posX?: number; posY?: number };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const plantingId = body.plantingId?.trim();
  if (!plantingId) return c.json({ error: 'plantingId wajib diisi' }, 400);

  // Bedengan dan tanaman dicek kepemilikannya: tanpa ini seseorang bisa
  // menempelkan tanaman orang lain ke denahnya sendiri lewat id tebakan.
  const [bed, planting] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, width_cm, length_cm FROM garden_beds WHERE id = ?1 AND user_id = ?2')
      .bind(bedId, user.sub).first<{ id: string; name: string; width_cm: number; length_cm: number }>(),
    c.env.DB.prepare('SELECT id, plant_id FROM garden_plantings WHERE id = ?1 AND user_id = ?2')
      .bind(plantingId, user.sub).first<{ id: string; plant_id: string | null }>(),
  ]);

  if (!bed) return c.json({ error: 'bedengan tidak ditemukan' }, 404);
  if (!planting) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const posX = Math.round(body.posX ?? -1);
  const posY = Math.round(body.posY ?? -1);
  if (posX < 0 || posY < 0 || posX > bed.width_cm || posY > bed.length_cm) {
    return c.json({ error: 'posisi di luar bedengan' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO garden_bed_slots (planting_id, bed_id, user_id, pos_x, pos_y)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(planting_id) DO UPDATE SET bed_id = ?2, pos_x = ?4, pos_y = ?5`
  ).bind(plantingId, bedId, user.sub, posX, posY).run();

  return c.json({ ok: true });
});

// DELETE /api/garden/beds/slots/:plantingId — angkat tanaman dari denah
extra.delete('/beds/slots/:plantingId', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare('DELETE FROM garden_bed_slots WHERE planting_id = ?1 AND user_id = ?2')
    .bind(c.req.param('plantingId'), user.sub).run();
  return c.json({ ok: true });
});

// GET /api/garden/beds/:id/suggest?spacing= — titik kosong terdekat
extra.get('/beds/:id/suggest', async (c) => {
  const user = c.get('user');
  const bedId = c.req.param('id');

  const bedRow = await c.env.DB.prepare(
    'SELECT id, name, width_cm, length_cm FROM garden_beds WHERE id = ?1 AND user_id = ?2'
  ).bind(bedId, user.sub).first<{ id: string; name: string; width_cm: number; length_cm: number }>();
  if (!bedRow) return c.json({ error: 'bedengan tidak ditemukan' }, 404);

  const slotRows = (await c.env.DB.prepare(
    `SELECT s.planting_id, s.pos_x, s.pos_y, p.plant_id, p.nickname, p.custom_name
       FROM garden_bed_slots s
       JOIN garden_plantings p ON p.id = s.planting_id
      WHERE s.bed_id = ?1 AND s.user_id = ?2`
  ).bind(bedId, user.sub).all<{
    planting_id: string; pos_x: number; pos_y: number;
    plant_id: string | null; nickname: string | null; custom_name: string | null;
  }>()).results ?? [];

  const plants = await resolvePlants(
    c.env.DB, slotRows.map((s) => s.plant_id).filter((id): id is string => !!id)
  );

  const slots: BedSlot[] = slotRows.map((s) => {
    const plant = s.plant_id ? plants.get(s.plant_id) : undefined;
    return {
      plantingId: s.planting_id,
      name: s.nickname || plant?.name || s.custom_name || 'Tanaman',
      posX: s.pos_x,
      posY: s.pos_y,
      spacingCm: plant?.spacingCm ?? 0,
    };
  });

  const spacing = Number(c.req.query('spacing')) || 20;
  const bed: Bed = { id: bedRow.id, name: bedRow.name, widthCm: bedRow.width_cm, lengthCm: bedRow.length_cm };

  return c.json({ suggestion: suggestSlot(bed, slots, spacing) });
});

// ─────────────────── #18 DARI KEBUN KE PIRING ───────────────────

// GET /api/garden/kitchen?month=YYYY-MM — nilai panen vs belanja makanan
extra.get('/kitchen', async (c) => {
  const user = c.get('user');
  const month = c.req.query('month') ?? jakartaToday().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month harus YYYY-MM' }, 400);

  const from = `${month}-01`;
  const to = `${month}-31`;

  const [harvestRes, priceRes, spendRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.plant_id, p.nickname, p.custom_name, l.amount, l.unit, l.action_date
         FROM garden_care_log l
         JOIN garden_plantings p ON p.id = l.planting_id
        WHERE l.user_id = ?1 AND l.action = 'panen' AND l.amount IS NOT NULL
          AND l.action_date >= ?2 AND l.action_date <= ?3`
    ).bind(user.sub, from, to).all<{
      plant_id: string | null; nickname: string | null; custom_name: string | null;
      amount: number; unit: string | null; action_date: string;
    }>(),
    c.env.DB.prepare('SELECT plant_key, price_idr FROM garden_plant_price WHERE user_id = ?1')
      .bind(user.sub).all<{ plant_key: string; price_idr: number }>(),
    // Belanja makanan bulan ini: itulah pembanding yang membuat nilai panen
    // punya arti. Kategorinya dicocokkan longgar supaya "Makanan" dan
    // "Makan & Minum" sama-sama terhitung.
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM budget_entries
        WHERE user_id = ?1 AND type = 'expense'
          AND entry_date >= ?2 AND entry_date <= ?3
          AND (lower(category) LIKE '%makan%' OR lower(category) LIKE '%belanja%'
               OR lower(category) LIKE '%dapur%' OR lower(category) LIKE '%sayur%')`
    ).bind(user.sub, from, to).first<{ total: number }>(),
  ]);

  const harvests: HarvestEntry[] = (harvestRes.results ?? []).map((r) => {
    const plant = r.plant_id ? PLANT_BY_ID.get(r.plant_id) : undefined;
    return {
      key: priceKey(r.plant_id, r.custom_name),
      name: r.nickname || plant?.name || r.custom_name || 'Tanaman',
      amount: r.amount,
      unit: r.unit ?? 'kg',
      date: r.action_date,
    };
  });

  const prices = new Map<string, number>();
  // plant_key sudah disimpan dalam bentuk yang sama dengan priceKey(): id
  // katalog, atau nama kustom yang dinormalisasi.
  for (const p of priceRes.results ?? []) prices.set(p.plant_key, p.price_idr);

  return c.json(buildKitchenReport(harvests, prices, spendRes?.total ?? 0, from, to));
});

// ─────────────────── #19 LAPORAN KEBUN TAHUNAN ───────────────────

// GET /api/garden/annual-report?year=YYYY — rekap setahun untuk diekspor PDF
extra.get('/annual-report', async (c) => {
  const user = c.get('user');
  const year = c.req.query('year') ?? jakartaToday().slice(0, 4);
  if (!/^\d{4}$/.test(year)) return c.json({ error: 'year harus YYYY' }, 400);

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [harvestRes, costRes, priceRes, plantedRes, failedRes, pestRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.plant_id, p.nickname, p.custom_name, l.amount, l.unit
         FROM garden_care_log l
         JOIN garden_plantings p ON p.id = l.planting_id
        WHERE l.user_id = ?1 AND l.action = 'panen' AND l.amount IS NOT NULL
          AND l.action_date >= ?2 AND l.action_date <= ?3`
    ).bind(user.sub, from, to).all<{
      plant_id: string | null; nickname: string | null; custom_name: string | null;
      amount: number; unit: string | null;
    }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_idr), 0) AS total FROM garden_costs
        WHERE user_id = ?1 AND cost_date >= ?2 AND cost_date <= ?3`
    ).bind(user.sub, from, to).first<{ total: number }>(),
    c.env.DB.prepare('SELECT plant_key, price_idr FROM garden_plant_price WHERE user_id = ?1')
      .bind(user.sub).all<{ plant_key: string; price_idr: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM garden_plantings
        WHERE user_id = ?1 AND planted_date >= ?2 AND planted_date <= ?3`
    ).bind(user.sub, from, to).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM garden_plantings
        WHERE user_id = ?1 AND status = 'gagal' AND planted_date >= ?2 AND planted_date <= ?3`
    ).bind(user.sub, from, to).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM garden_pest_log
        WHERE user_id = ?1 AND spotted_date >= ?2 AND spotted_date <= ?3`
    ).bind(user.sub, from, to).first<{ n: number }>(),
  ]);

  const prices = new Map<string, number>();
  // plant_key sudah disimpan dalam bentuk yang sama dengan priceKey(): id
  // katalog, atau nama kustom yang dinormalisasi.
  for (const p of priceRes.results ?? []) prices.set(p.plant_key, p.price_idr);

  const harvests: HarvestEntry[] = (harvestRes.results ?? []).map((r) => {
    const plant = r.plant_id ? PLANT_BY_ID.get(r.plant_id) : undefined;
    return {
      key: priceKey(r.plant_id, r.custom_name),
      name: r.nickname || plant?.name || r.custom_name || 'Tanaman',
      amount: r.amount,
      unit: r.unit ?? 'kg',
      date: from,
    };
  });

  // Laporan tahunan memakai mesin hitung yang sama dengan "dari kebun ke
  // piring": satu definisi nilai panen, dipakai di dua tempat.
  const value = buildKitchenReport(harvests, prices, 0, from, to);
  const costs = costRes?.total ?? 0;
  const planted = plantedRes?.n ?? 0;
  const failed = failedRes?.n ?? 0;

  return c.json({
    year,
    plantedCount: planted,
    failedCount: failed,
    successPercent: planted > 0 ? Math.round(((planted - failed) / planted) * 100) : null,
    pestCount: pestRes?.n ?? 0,
    harvestValueIdr: value.harvestValueIdr,
    costIdr: costs,
    netIdr: value.harvestValueIdr - costs,
    items: value.items,
    unpricedHarvests: value.unpricedHarvests,
  });
});

export default extra;
