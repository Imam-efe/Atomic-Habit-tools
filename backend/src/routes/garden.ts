import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import { runJson, runText, SCHEMA_MODEL } from '../lib/ai';
import { PLANTS, PLANT_BY_ID, CATEGORY_LABELS, type Plant } from '../data/plants';

const garden = new Hono<AuthContext>();
garden.use('/*', requireAuth);

const CARE_ACTIONS = ['siram', 'pupuk', 'panen', 'pangkas', 'semprot', 'catatan'] as const;
type CareAction = (typeof CARE_ACTIONS)[number];

const PLANTING_STATUSES = ['tumbuh', 'panen', 'selesai', 'gagal'] as const;
const PLANTING_METHODS = ['benih', 'bibit', 'stek', 'umbi'] as const;

/** Status yang masih dirawat aktif — hanya ini yang muncul di jadwal. */
const ACTIVE_STATUSES = ['tumbuh', 'panen'];

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

function isISODate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Slug ternormalisasi — kunci cache AI, juga mencegah nama liar jadi id. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export interface PlantingRow {
  id: string;
  plant_id: string | null;
  custom_name: string | null;
  nickname: string | null;
  location: string | null;
  quantity: number;
  planting_method: string | null;
  planted_date: string;
  expected_harvest_date: string | null;
  status: string;
  note: string | null;
}

/**
 * Resolusi data tanaman: katalog dulu, lalu cache AI.
 *
 * Keduanya menghasilkan bentuk `Plant` yang sama, jadi seluruh perhitungan
 * jadwal di bawah tidak perlu tahu asal datanya.
 */
export async function resolvePlants(db: D1Database, plantIds: string[]): Promise<Map<string, Plant>> {
  const out = new Map<string, Plant>();
  const missing: string[] = [];

  for (const id of plantIds) {
    const known = PLANT_BY_ID.get(id);
    if (known) out.set(id, known);
    else missing.push(id);
  }

  if (missing.length > 0) {
    const placeholders = missing.map((_, i) => `?${i + 1}`).join(',');
    const rows = await db.prepare(
      `SELECT id, payload FROM garden_ai_plants WHERE id IN (${placeholders})`
    ).bind(...missing).all<{ id: string; payload: string }>();

    for (const row of rows.results ?? []) {
      try {
        out.set(row.id, JSON.parse(row.payload) as Plant);
      } catch {
        // Cache rusak diperlakukan seperti tidak ada — tanaman tetap tampil,
        // hanya tanpa jadwal otomatis.
      }
    }
  }

  return out;
}

export interface CareState {
  lastWater: string | null;
  nextWater: string | null;
  waterOverdueDays: number;
  lastFertilize: string | null;
  nextFertilize: string | null;
  fertilizeOverdueDays: number;
  lastHarvest: string | null;
  nextHarvest: string | null;
  harvestReady: boolean;
  ageDays: number;
  /** 0–100, progres menuju panen pertama. */
  growthPercent: number;
}

export function computeCareState(
  planting: PlantingRow,
  plant: Plant | undefined,
  last: { siram?: string; pupuk?: string; panen?: string },
  today: string
): CareState {
  const ageDays = Math.max(0, daysBetween(planting.planted_date, today));

  const lastWater = last.siram ?? null;
  const lastFertilize = last.pupuk ?? null;
  const lastHarvest = last.panen ?? null;

  // Tanaman di luar katalog dan di luar cache AI: tidak ada interval yang bisa
  // dipakai, jadi tidak dijadwalkan — bukan dijadwalkan dengan angka tebakan.
  if (!plant) {
    return {
      lastWater, nextWater: null, waterOverdueDays: 0,
      lastFertilize, nextFertilize: null, fertilizeOverdueDays: 0,
      lastHarvest, nextHarvest: null, harvestReady: false,
      ageDays, growthPercent: 0,
    };
  }

  const nextWater = addDays(lastWater ?? planting.planted_date, plant.waterIntervalDays);
  const nextFertilize = addDays(lastFertilize ?? planting.planted_date, plant.fertilizeIntervalDays);

  const firstHarvest = planting.expected_harvest_date
    ?? addDays(planting.planted_date, plant.daysToHarvest[0]);

  let nextHarvest: string | null;
  if (!lastHarvest) {
    nextHarvest = firstHarvest;
  } else if (plant.repeatHarvest && plant.harvestEveryDays) {
    nextHarvest = addDays(lastHarvest, plant.harvestEveryDays);
  } else {
    // Panen sekali cabut yang sudah dipanen — tidak ada panen berikutnya.
    nextHarvest = null;
  }

  return {
    lastWater,
    nextWater,
    waterOverdueDays: Math.max(0, daysBetween(nextWater, today)),
    lastFertilize,
    nextFertilize,
    fertilizeOverdueDays: Math.max(0, daysBetween(nextFertilize, today)),
    lastHarvest,
    nextHarvest,
    harvestReady: nextHarvest !== null && nextHarvest <= today,
    ageDays,
    growthPercent: Math.min(100, Math.round((ageDays / Math.max(1, plant.daysToHarvest[0])) * 100)),
  };
}

/** Ambil tanggal aksi terakhir per (planting, action) dalam satu query. */
export async function lastActions(
  db: D1Database,
  userId: string
): Promise<Map<string, { siram?: string; pupuk?: string; panen?: string }>> {
  const rows = await db.prepare(`
    SELECT planting_id, action, MAX(action_date) AS last_date
    FROM garden_care_log
    WHERE user_id = ?1 AND action IN ('siram', 'pupuk', 'panen')
    GROUP BY planting_id, action
  `).bind(userId).all<{ planting_id: string; action: string; last_date: string }>();

  const map = new Map<string, { siram?: string; pupuk?: string; panen?: string }>();
  for (const r of rows.results ?? []) {
    const entry = map.get(r.planting_id) ?? {};
    entry[r.action as 'siram' | 'pupuk' | 'panen'] = r.last_date;
    map.set(r.planting_id, entry);
  }
  return map;
}

// ─────────────────────────────── KATALOG ───────────────────────────────

// GET /api/garden/catalog?q=&category=
garden.get('/catalog', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const category = c.req.query('category');

  let list = PLANTS;
  if (category) list = list.filter(p => p.category === category);
  if (q) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.latinName.toLowerCase().includes(q) ||
      p.id.includes(q)
    );
  }

  return c.json({
    categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
    total: PLANTS.length,
    plants: list,
  });
});

// GET /api/garden/catalog/:plantId — katalog atau hasil AI yang sudah di-cache
garden.get('/catalog/:plantId', async (c) => {
  const plantId = c.req.param('plantId');
  const resolved = await resolvePlants(c.env.DB, [plantId]);
  const plant = resolved.get(plantId);
  if (!plant) return c.json({ error: 'tanaman tidak ditemukan' }, 404);
  return c.json(plant);
});

// ────────────────────────────── PENANAMAN ──────────────────────────────

// GET /api/garden — semua tanaman pengguna + status perawatan turunan
garden.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const [rows, lastMap] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
              planted_date, expected_harvest_date, status, note
       FROM garden_plantings WHERE user_id = ?1 ORDER BY planted_date DESC`
    ).bind(user.sub).all<PlantingRow>(),
    lastActions(c.env.DB, user.sub),
  ]);

  const plantings = rows.results ?? [];
  const plantMap = await resolvePlants(
    c.env.DB,
    [...new Set(plantings.map(p => p.plant_id).filter((id): id is string => !!id))]
  );

  const enriched = plantings.map(p => {
    const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
    const care = computeCareState(p, plant, lastMap.get(p.id) ?? {}, today);
    return {
      id: p.id,
      plantId: p.plant_id,
      name: plant?.name ?? p.custom_name ?? 'Tanaman',
      emoji: plant?.emoji ?? '🌱',
      category: plant?.category ?? null,
      latinName: plant?.latinName ?? null,
      nickname: p.nickname,
      location: p.location,
      quantity: p.quantity,
      plantingMethod: p.planting_method,
      plantedDate: p.planted_date,
      expectedHarvestDate: p.expected_harvest_date,
      status: p.status,
      note: p.note,
      care,
    };
  });

  const active = enriched.filter(p => ACTIVE_STATUSES.includes(p.status));

  return c.json({
    today,
    plantings: enriched,
    summary: {
      total: enriched.length,
      active: active.length,
      needWater: active.filter(p => p.care.waterOverdueDays > 0).length,
      needFertilize: active.filter(p => p.care.fertilizeOverdueDays > 0).length,
      readyToHarvest: active.filter(p => p.care.harvestReady).length,
    },
  });
});

// GET /api/garden/schedule?days=7 — apa yang jatuh tempo hari ini dan beberapa hari ke depan
garden.get('/schedule', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const horizon = Math.min(30, Math.max(1, Number(c.req.query('days')) || 7));
  const until = addDays(today, horizon);

  const [rows, lastMap] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
              planted_date, expected_harvest_date, status, note
       FROM garden_plantings WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
    ).bind(user.sub).all<PlantingRow>(),
    lastActions(c.env.DB, user.sub),
  ]);

  const plantings = rows.results ?? [];
  const plantMap = await resolvePlants(
    c.env.DB,
    [...new Set(plantings.map(p => p.plant_id).filter((id): id is string => !!id))]
  );

  interface Due {
    plantingId: string;
    name: string;
    emoji: string;
    nickname: string | null;
    location: string | null;
    action: CareAction;
    dueDate: string;
    overdueDays: number;
  }

  const due: Due[] = [];
  for (const p of plantings) {
    const plant = p.plant_id ? plantMap.get(p.plant_id) : undefined;
    const care = computeCareState(p, plant, lastMap.get(p.id) ?? {}, today);
    const base = {
      plantingId: p.id,
      name: plant?.name ?? p.custom_name ?? 'Tanaman',
      emoji: plant?.emoji ?? '🌱',
      nickname: p.nickname,
      location: p.location,
    };

    const add = (action: CareAction, dueDate: string | null) => {
      if (!dueDate || dueDate > until) return;
      due.push({ ...base, action, dueDate, overdueDays: Math.max(0, daysBetween(dueDate, today)) });
    };

    add('siram', care.nextWater);
    add('pupuk', care.nextFertilize);
    add('panen', care.nextHarvest);
  }

  due.sort((a, b) => (a.dueDate === b.dueDate ? a.action.localeCompare(b.action) : a.dueDate.localeCompare(b.dueDate)));

  return c.json({
    today,
    horizonDays: horizon,
    overdue: due.filter(d => d.dueDate < today),
    todayDue: due.filter(d => d.dueDate === today),
    upcoming: due.filter(d => d.dueDate > today),
  });
});

// POST /api/garden — tanam sesuatu
garden.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    plantId?: string;
    customName?: string;
    nickname?: string;
    location?: string;
    quantity?: number;
    plantingMethod?: string;
    plantedDate?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const plantedDate = isISODate(body.plantedDate) ? body.plantedDate : jakartaToday();

  // Butuh salah satu: id yang bisa diresolusi, atau nama bebas.
  let plant: Plant | undefined;
  if (body.plantId) {
    plant = (await resolvePlants(c.env.DB, [body.plantId])).get(body.plantId);
    if (!plant) return c.json({ error: 'tanaman tidak ada di katalog' }, 400);
  } else if (!body.customName?.trim()) {
    return c.json({ error: 'plantId atau customName wajib diisi' }, 400);
  }

  const id = nanoid();
  const expectedHarvest = plant ? addDays(plantedDate, plant.daysToHarvest[0]) : null;
  const method = PLANTING_METHODS.includes(body.plantingMethod as (typeof PLANTING_METHODS)[number])
    ? body.plantingMethod!
    : null;

  await c.env.DB.prepare(`
    INSERT INTO garden_plantings
      (id, user_id, plant_id, custom_name, nickname, location, quantity,
       planting_method, planted_date, expected_harvest_date, status, note)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'tumbuh', ?11)
  `).bind(
    id, user.sub, body.plantId ?? null,
    plant ? null : body.customName!.trim(),
    body.nickname?.trim() || null,
    body.location?.trim() || null,
    body.quantity && body.quantity > 0 ? Math.round(body.quantity) : 1,
    method, plantedDate, expectedHarvest,
    body.note?.trim() || null
  ).run();

  return c.json({
    id,
    plantId: body.plantId ?? null,
    name: plant?.name ?? body.customName!.trim(),
    emoji: plant?.emoji ?? '🌱',
    plantedDate,
    expectedHarvestDate: expectedHarvest,
    status: 'tumbuh',
  }, 201);
});

// PUT /api/garden/:id
garden.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    nickname?: string;
    location?: string;
    quantity?: number;
    status?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const status = PLANTING_STATUSES.includes(body.status as (typeof PLANTING_STATUSES)[number])
    ? body.status!
    : 'tumbuh';

  const res = await c.env.DB.prepare(`
    UPDATE garden_plantings
    SET nickname = ?1, location = ?2, quantity = ?3, status = ?4, note = ?5
    WHERE id = ?6 AND user_id = ?7
  `).bind(
    body.nickname?.trim() || null,
    body.location?.trim() || null,
    body.quantity && body.quantity > 0 ? Math.round(body.quantity) : 1,
    status,
    body.note?.trim() || null,
    id, user.sub
  ).run();

  if (res.meta.changes === 0) return c.json({ error: 'tanaman tidak ditemukan' }, 404);
  return c.json({ id, status });
});

// DELETE /api/garden/:id
garden.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM garden_plantings WHERE id = ?1 AND user_id = ?2')
    .bind(id, user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'tanaman tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ──────────────────────────── LOG PERAWATAN ────────────────────────────

// POST /api/garden/:id/care — catat siram / pupuk / panen / dst
garden.post('/:id/care', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('id');
  type Body = { action?: string; date?: string; amount?: number; unit?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  if (!CARE_ACTIONS.includes(body.action as CareAction)) {
    return c.json({ error: `action harus salah satu dari: ${CARE_ACTIONS.join(', ')}` }, 400);
  }
  const action = body.action as CareAction;

  const owned = await c.env.DB.prepare(
    'SELECT id, status FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, user.sub).first<{ id: string; status: string }>();
  if (!owned) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const date = isISODate(body.date) ? body.date : jakartaToday();
  const id = nanoid();

  await c.env.DB.prepare(`
    INSERT INTO garden_care_log (id, user_id, planting_id, action, action_date, amount, unit, note)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    id, user.sub, plantingId, action, date,
    typeof body.amount === 'number' && body.amount > 0 ? body.amount : null,
    body.unit?.trim() || null,
    body.note?.trim() || null
  ).run();

  // Panen pertama menaikkan status jadi 'panen' — sinyal ke UI bahwa tanaman
  // ini sudah produktif, dan untuk yang sekali cabut jadi penanda siklus usai.
  if (action === 'panen' && owned.status === 'tumbuh') {
    await c.env.DB.prepare("UPDATE garden_plantings SET status = 'panen' WHERE id = ?1")
      .bind(plantingId).run();
  }

  return c.json({ id, action, date }, 201);
});

// GET /api/garden/:id/care — riwayat perawatan satu tanaman
garden.get('/:id/care', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('id');

  const owned = await c.env.DB.prepare(
    'SELECT id FROM garden_plantings WHERE id = ?1 AND user_id = ?2'
  ).bind(plantingId, user.sub).first<{ id: string }>();
  if (!owned) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const rows = await c.env.DB.prepare(`
    SELECT id, action, action_date, amount, unit, note
    FROM garden_care_log WHERE planting_id = ?1
    ORDER BY action_date DESC, created_at DESC LIMIT 50
  `).bind(plantingId).all<{
    id: string; action: string; action_date: string;
    amount: number | null; unit: string | null; note: string | null;
  }>();

  return c.json((rows.results ?? []).map(r => ({
    id: r.id, action: r.action, date: r.action_date,
    amount: r.amount, unit: r.unit, note: r.note,
  })));
});

// DELETE /api/garden/care/:logId
garden.delete('/care/:logId', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare('DELETE FROM garden_care_log WHERE id = ?1 AND user_id = ?2')
    .bind(c.req.param('logId'), user.sub).run();
  if (res.meta.changes === 0) return c.json({ error: 'catatan tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// ───────────────────────────────── AI ─────────────────────────────────
//
// Katalog di plants.ts sengaja dibatasi pada tanaman yang datanya bisa
// dipertanggungjawabkan. AI di bawah menutup sisanya: tanaman di luar katalog,
// diagnosis masalah yang tidak bisa ditabelkan, dan saran yang bergantung pada
// riwayat perawatan pengguna sendiri.

interface RawPlantInfo {
  name?: string;
  latin_name?: string;
  category?: string;
  emoji?: string;
  days_to_harvest_min?: number;
  days_to_harvest_max?: number;
  repeat_harvest?: boolean;
  harvest_every_days?: number;
  water_interval_days?: number;
  water_note?: string;
  fertilize_interval_days?: number;
  fertilizer?: string;
  sunlight?: string;
  spacing_cm?: number;
  pot_liter?: number;
  difficulty?: string;
  season?: string;
  altitude?: string;
  pests?: string[];
  propagation?: string;
  harvest_note?: string;
  tips?: string;
}

const PLANT_INFO_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Nama tanaman dalam Bahasa Indonesia' },
    latin_name: { type: 'string' },
    category: { type: 'string', enum: ['sayuran-daun', 'sayuran-buah', 'umbi', 'rempah', 'buah'] },
    emoji: { type: 'string', description: 'Satu emoji yang mewakili tanaman ini' },
    days_to_harvest_min: { type: 'number', description: 'Umur panen tercepat dalam hari sejak tanam' },
    days_to_harvest_max: { type: 'number' },
    repeat_harvest: { type: 'boolean', description: 'true kalau dipanen berulang seperti cabai, false kalau sekali cabut seperti bayam' },
    harvest_every_days: { type: 'number', description: 'Jarak antar panen dalam hari, 0 kalau sekali panen' },
    water_interval_days: { type: 'number', description: 'Interval siram normal di iklim Indonesia, hari' },
    water_note: { type: 'string' },
    fertilize_interval_days: { type: 'number' },
    fertilizer: { type: 'string' },
    sunlight: { type: 'string', enum: ['penuh', 'sebagian', 'teduh'] },
    spacing_cm: { type: 'number' },
    pot_liter: { type: 'number', description: 'Volume pot minimum dalam liter, 0 kalau tidak cocok di pot' },
    difficulty: { type: 'string', enum: ['mudah', 'sedang', 'sulit'] },
    season: { type: 'string', description: 'Musim tanam terbaik di Indonesia' },
    altitude: { type: 'string', description: 'Ketinggian yang cocok: rendah, menengah, atau tinggi' },
    pests: { type: 'array', items: { type: 'string' }, description: 'Hama dan penyakit umum' },
    propagation: { type: 'string' },
    harvest_note: { type: 'string' },
    tips: { type: 'string', description: 'Satu tips praktis paling berguna' },
  },
  required: ['name', 'days_to_harvest_min', 'water_interval_days', 'fertilize_interval_days', 'sunlight'],
} as const;

const CATEGORIES = ['sayuran-daun', 'sayuran-buah', 'umbi', 'rempah', 'buah'];
const SUNLIGHTS = ['penuh', 'sebagian', 'teduh'];
const DIFFICULTIES = ['mudah', 'sedang', 'sulit'];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Ubah keluaran AI jadi `Plant` yang valid — semua angka dibatasi ke rentang masuk akal. */
function normalizeAiPlant(id: string, raw: RawPlantInfo): Plant {
  const minDays = clampInt(raw.days_to_harvest_min, 7, 3650, 60);
  const maxDays = Math.max(minDays, clampInt(raw.days_to_harvest_max, 7, 3650, minDays));
  const repeat = raw.repeat_harvest === true;
  const every = clampInt(raw.harvest_every_days, 1, 365, 14);

  return {
    id,
    name: (raw.name ?? id).slice(0, 60),
    latinName: (raw.latin_name ?? '').slice(0, 80),
    category: (CATEGORIES.includes(raw.category ?? '') ? raw.category : 'sayuran-buah') as Plant['category'],
    emoji: (raw.emoji ?? '🌱').slice(0, 4),
    daysToHarvest: [minDays, maxDays],
    repeatHarvest: repeat,
    harvestEveryDays: repeat ? every : null,
    waterIntervalDays: clampInt(raw.water_interval_days, 1, 30, 2),
    waterNote: (raw.water_note ?? '').slice(0, 300),
    fertilizeIntervalDays: clampInt(raw.fertilize_interval_days, 7, 180, 30),
    fertilizer: (raw.fertilizer ?? '').slice(0, 200),
    sunlight: (SUNLIGHTS.includes(raw.sunlight ?? '') ? raw.sunlight : 'penuh') as Plant['sunlight'],
    spacingCm: clampInt(raw.spacing_cm, 5, 1000, 40),
    potLiter: clampInt(raw.pot_liter, 0, 200, 15),
    difficulty: (DIFFICULTIES.includes(raw.difficulty ?? '') ? raw.difficulty : 'sedang') as Plant['difficulty'],
    season: (raw.season ?? 'Sepanjang tahun').slice(0, 120),
    phRange: [5.5, 7.0],
    altitude: (raw.altitude ?? 'rendah sampai menengah').slice(0, 80),
    pests: (raw.pests ?? []).filter(p => typeof p === 'string').slice(0, 8).map(p => p.slice(0, 60)),
    companions: [],
    avoid: [],
    propagation: (raw.propagation ?? '').slice(0, 200),
    harvestNote: (raw.harvest_note ?? '').slice(0, 300),
    tips: (raw.tips ?? '').slice(0, 400),
  };
}

// POST /api/garden/identify — { name } → data tanaman di luar katalog
//
// Hasilnya di-cache global di garden_ai_plants: isinya fakta botani umum,
// bukan data pribadi, jadi satu panggilan AI melayani semua pengguna.
garden.post('/identify', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name || name.length < 2) return c.json({ error: 'nama tanaman wajib diisi' }, 400);
  if (name.length > 60) return c.json({ error: 'nama tanaman terlalu panjang' }, 400);

  const id = slugify(name);
  if (!id) return c.json({ error: 'nama tanaman tidak valid' }, 400);

  // Sudah ada di katalog bawaan — tidak perlu AI sama sekali.
  const known = PLANT_BY_ID.get(id);
  if (known) return c.json({ plant: known, source: 'katalog' });

  const cached = await c.env.DB.prepare('SELECT payload FROM garden_ai_plants WHERE id = ?1')
    .bind(id).first<{ payload: string }>();
  if (cached) {
    try {
      return c.json({ plant: JSON.parse(cached.payload) as Plant, source: 'cache' });
    } catch {
      // Cache rusak — jatuh ke pemanggilan AI di bawah dan menimpanya.
    }
  }

  let raw: RawPlantInfo | null = null;
  try {
    raw = await runJson<RawPlantInfo>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu ahli hortikultura Indonesia. Berikan data budidaya praktis untuk pekarangan/polybag di iklim tropis Indonesia. Semua teks dalam Bahasa Indonesia. Angka harus realistis untuk penanaman rumahan, bukan pertanian komersial. Kalau yang diminta jelas bukan tanaman, tetap isi sebisanya tapi beri nama apa adanya.',
        },
        { role: 'user', content: `Data budidaya untuk tanaman: "${name}"` },
      ],
      PLANT_INFO_SCHEMA as unknown as Record<string, unknown>,
      { maxTokens: 800 }
    );
  } catch (err) {
    console.error('Garden identify failed', err);
    return c.json({ error: 'Gagal mencari data tanaman' }, 502);
  }

  if (!raw?.name) return c.json({ error: 'Tanaman tidak dikenali' }, 422);

  const plant = normalizeAiPlant(id, raw);
  await c.env.DB.prepare(`
    INSERT INTO garden_ai_plants (id, name, payload, created_at)
    VALUES (?1, ?2, ?3, unixepoch())
    ON CONFLICT(id) DO UPDATE SET name = ?2, payload = ?3, created_at = unixepoch()
  `).bind(id, plant.name, JSON.stringify(plant)).run();

  return c.json({ plant, source: 'ai' });
});

interface RawDiagnosis {
  diagnosis?: string;
  confidence?: string;
  cause?: string;
  treatment?: string[];
  prevention?: string;
  urgency?: string;
}

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    diagnosis: { type: 'string', description: 'Nama hama/penyakit/masalah yang paling mungkin' },
    confidence: { type: 'string', enum: ['tinggi', 'sedang', 'rendah'] },
    cause: { type: 'string', description: 'Penyebabnya, 1-2 kalimat' },
    treatment: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 langkah penanganan konkret, dahulukan cara organik',
    },
    prevention: { type: 'string', description: 'Cara mencegah berulang, 1-2 kalimat' },
    urgency: { type: 'string', enum: ['segera', 'minggu-ini', 'pantau'] },
  },
  required: ['diagnosis', 'cause', 'treatment'],
} as const;

// POST /api/garden/diagnose — { plantingId?, symptoms?, image? } → diagnosis hama/penyakit
//
// Gejala tanaman tidak bisa ditabelkan seperti interval siram, jadi ini murni
// AI. Foto opsional; kalau ada, dipakai model vision yang sama dengan OCR struk.
garden.post('/diagnose', async (c) => {
  const user = c.get('user');
  type Body = { plantingId?: string; symptoms?: string; image?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const symptoms = body.symptoms?.trim();
  const image = body.image?.trim();
  if (!symptoms && !image) return c.json({ error: 'isi gejala atau unggah foto' }, 400);
  if (image) {
    if (!image.startsWith('data:image/')) return c.json({ error: 'foto harus data URL' }, 400);
    if (image.length > 6_000_000) return c.json({ error: 'foto terlalu besar' }, 413);
  }

  // Konteks tanaman menaikkan akurasi banyak — hama cabai beda dari hama sawi.
  let context = '';
  if (body.plantingId) {
    const row = await c.env.DB.prepare(
      `SELECT plant_id, custom_name, planted_date FROM garden_plantings WHERE id = ?1 AND user_id = ?2`
    ).bind(body.plantingId, user.sub).first<{
      plant_id: string | null; custom_name: string | null; planted_date: string;
    }>();

    if (row) {
      const plant = row.plant_id ? (await resolvePlants(c.env.DB, [row.plant_id])).get(row.plant_id) : undefined;
      const name = plant?.name ?? row.custom_name ?? 'tanaman';
      const age = Math.max(0, daysBetween(row.planted_date, jakartaToday()));
      context = [
        `Tanaman: ${name}${plant?.latinName ? ` (${plant.latinName})` : ''}, umur ${age} hari sejak tanam.`,
        plant?.pests.length ? `Hama yang lazim pada tanaman ini: ${plant.pests.join(', ')}.` : '',
      ].filter(Boolean).join(' ');
    }
  }

  const userText = [context, symptoms ? `Gejala yang terlihat: ${symptoms}` : 'Lihat foto terlampir.']
    .filter(Boolean).join('\n');

  let raw: RawDiagnosis | null = null;
  try {
    raw = await runJson<RawDiagnosis>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu ahli hama dan penyakit tanaman di Indonesia. Diagnosis masalah dari gejala atau foto yang diberikan, lalu beri langkah penanganan yang bisa langsung dikerjakan pekebun rumahan. Dahulukan solusi organik dan bahan yang mudah didapat; sebut pestisida kimia hanya kalau memang perlu. Semua dalam Bahasa Indonesia. Kalau gejalanya terlalu umum, katakan begitu lewat confidence rendah, jangan mengarang.',
        },
        {
          role: 'user',
          content: image
            ? [
                { type: 'text' as const, text: userText },
                { type: 'image_url' as const, image_url: { url: image } },
              ]
            : userText,
        },
      ],
      DIAGNOSIS_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 700 }
    );
  } catch (err) {
    console.error('Garden diagnose failed', err);
    return c.json({ error: 'Diagnosis gagal' }, 502);
  }

  if (!raw?.diagnosis) return c.json({ error: 'Tidak bisa mendiagnosis dari data ini' }, 422);

  return c.json({
    diagnosis: raw.diagnosis.slice(0, 120),
    confidence: ['tinggi', 'sedang', 'rendah'].includes(raw.confidence ?? '') ? raw.confidence : 'sedang',
    cause: (raw.cause ?? '').slice(0, 400),
    treatment: (raw.treatment ?? []).filter(t => typeof t === 'string' && t.trim()).slice(0, 6).map(t => t.trim().slice(0, 250)),
    prevention: (raw.prevention ?? '').slice(0, 400),
    urgency: ['segera', 'minggu-ini', 'pantau'].includes(raw.urgency ?? '') ? raw.urgency : 'minggu-ini',
  });
});

// POST /api/garden/:id/insight — saran naratif dari riwayat perawatan nyata
//
// Ini yang tidak bisa dilakukan katalog: menilai apakah pola siram/pupuk
// pengguna sendiri sudah sesuai umur tanamannya.
garden.post('/:id/insight', async (c) => {
  const user = c.get('user');
  const plantingId = c.req.param('id');
  const today = jakartaToday();

  const row = await c.env.DB.prepare(
    `SELECT id, plant_id, custom_name, nickname, location, quantity, planting_method,
            planted_date, expected_harvest_date, status, note
     FROM garden_plantings WHERE id = ?1 AND user_id = ?2`
  ).bind(plantingId, user.sub).first<PlantingRow>();
  if (!row) return c.json({ error: 'tanaman tidak ditemukan' }, 404);

  const plant = row.plant_id ? (await resolvePlants(c.env.DB, [row.plant_id])).get(row.plant_id) : undefined;

  const counts = await c.env.DB.prepare(`
    SELECT action, COUNT(*) AS n, MAX(action_date) AS last_date
    FROM garden_care_log WHERE planting_id = ?1 GROUP BY action
  `).bind(plantingId).all<{ action: string; n: number; last_date: string }>();

  const byAction = new Map((counts.results ?? []).map(r => [r.action, r]));
  const care = computeCareState(
    row,
    plant,
    {
      siram: byAction.get('siram')?.last_date,
      pupuk: byAction.get('pupuk')?.last_date,
      panen: byAction.get('panen')?.last_date,
    },
    today
  );

  const name = plant?.name ?? row.custom_name ?? 'tanaman';
  const lines = [
    `Tanaman: ${name}${plant?.latinName ? ` (${plant.latinName})` : ''}.`,
    `Ditanam ${row.planted_date}, umur ${care.ageDays} hari, status ${row.status}.`,
    row.location ? `Lokasi: ${row.location}.` : '',
    plant ? `Anjuran katalog: siram tiap ${plant.waterIntervalDays} hari, pupuk tiap ${plant.fertilizeIntervalDays} hari, panen sekitar ${plant.daysToHarvest[0]}–${plant.daysToHarvest[1]} hari.` : '',
    `Riwayat: disiram ${byAction.get('siram')?.n ?? 0} kali (terakhir ${care.lastWater ?? 'belum pernah'}), dipupuk ${byAction.get('pupuk')?.n ?? 0} kali (terakhir ${care.lastFertilize ?? 'belum pernah'}), dipanen ${byAction.get('panen')?.n ?? 0} kali.`,
    care.waterOverdueDays > 0 ? `Penyiraman telat ${care.waterOverdueDays} hari.` : '',
    care.fertilizeOverdueDays > 0 ? `Pemupukan telat ${care.fertilizeOverdueDays} hari.` : '',
    care.harvestReady ? 'Sudah masuk perkiraan waktu panen.' : '',
  ].filter(Boolean).join('\n');

  let insight = '';
  try {
    insight = await runText(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu pendamping berkebun untuk pekebun rumahan Indonesia. Baca data satu tanaman dan riwayat perawatannya, lalu tulis 1 paragraf pendek (3-5 kalimat) dalam Bahasa Indonesia: apa yang sudah bagus, apa yang perlu diperbaiki, dan satu langkah paling penting untuk minggu ini. Spesifik pada angka yang diberikan. Tanpa markdown, tanpa daftar bernomor.',
        },
        { role: 'user', content: lines },
      ],
      { maxTokens: 350 }
    );
  } catch (err) {
    console.error('Garden insight failed', err);
    return c.json({ error: 'Gagal membuat insight' }, 502);
  }

  insight = insight.trim();
  if (!insight) return c.json({ error: 'Gagal membuat insight' }, 502);

  return c.json({ plantingId, name, care, insight });
});

export default garden;
