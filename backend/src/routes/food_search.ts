import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { runJson, runText, SCHEMA_MODEL } from '../lib/ai';
import { searchCuratedFoods, type CuratedFood } from '../data/foods_id';
import type { Env } from '../types';
import { jakartaToday } from '../lib/validate';
import { ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing, type AlgNutrients } from '../lib/nutrition_insight';

const foodSearch = new Hono<AuthContext>();
foodSearch.use('/*', requireAuth);

// 90 hari — reformulasi produk biasanya lebih lambat dari ini.
const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface FoodResult {
  name: string;
  brand: string | null;
  servingSize: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number; // mg
  sugar: number;
  source: 'curated' | 'cache-off' | 'cache-ai' | 'off' | 'ai';
}

function normalizeLookupKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function curatedToResult(f: CuratedFood): FoodResult {
  return {
    name: f.name, brand: null, servingSize: f.servingLabel,
    calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
    fiber: f.fiber, sodium: f.sodium, sugar: f.sugar, source: 'curated',
  };
}

interface CacheRow {
  name: string; brand: string | null; serving_size: string | null;
  calories: number; protein: number; carbs: number; fat: number;
  fiber: number; sodium: number; sugar: number; fetched_at: number;
}

function cacheRowToResult(row: CacheRow, source: 'cache-off' | 'cache-ai'): FoodResult {
  return {
    name: row.name, brand: row.brand, servingSize: row.serving_size,
    calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat,
    fiber: row.fiber, sodium: row.sodium, sugar: row.sugar, source,
  };
}

async function getCached(db: D1Database, source: 'off' | 'ai', lookupKey: string): Promise<CacheRow | null> {
  const row = await db.prepare(
    'SELECT name, brand, serving_size, calories, protein, carbs, fat, fiber, sodium, sugar, fetched_at FROM food_facts_cache WHERE source = ?1 AND lookup_key = ?2'
  ).bind(source, lookupKey).first<CacheRow>();
  if (!row) return null;
  const ageSeconds = Math.floor(Date.now() / 1000) - row.fetched_at;
  if (ageSeconds > CACHE_TTL_SECONDS) return null; // stale — treat sebagai miss, re-resolve
  return row;
}

async function putCache(db: D1Database, source: 'off' | 'ai', lookupKey: string, r: FoodResult): Promise<void> {
  await db.prepare(`
    INSERT INTO food_facts_cache (id, source, lookup_key, name, brand, serving_size, calories, protein, carbs, fat, fiber, sodium, sugar, fetched_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, unixepoch())
    ON CONFLICT(source, lookup_key) DO UPDATE SET
      name = ?4, brand = ?5, serving_size = ?6, calories = ?7, protein = ?8, carbs = ?9,
      fat = ?10, fiber = ?11, sodium = ?12, sugar = ?13, fetched_at = unixepoch()
  `).bind(
    nanoid(), source, lookupKey, r.name, r.brand, r.servingSize,
    r.calories, r.protein, r.carbs, r.fat, r.fiber, r.sodium, r.sugar
  ).run();
}

interface OffNutriments {
  'energy-kcal_100g'?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sodium_100g?: number; // gram di response OFF
  sugars_100g?: number;
}
interface OffProduct {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: OffNutriments;
}
interface OffResponse {
  status?: number;
  product?: OffProduct;
}

/** Open Food Facts by barcode. Timeout 5s — jangan biarkan satu lookup menahan request pengguna. */
async function fetchOpenFoodFacts(barcode: string): Promise<FoodResult | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,nutriments,serving_size`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  let json: OffResponse;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AtomicHabitTools/1.0 (kontak via app)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch (err) {
    console.error('Open Food Facts fetch failed', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const p = json.product;
  const n = p?.nutriments;
  if (json.status !== 1 || !p || !n || n['energy-kcal_100g'] === undefined) return null;

  return {
    name: p.product_name?.trim() || 'Produk tanpa nama',
    brand: p.brands?.trim() || null,
    servingSize: p.serving_size?.trim() || null,
    calories: n['energy-kcal_100g'] ?? 0,
    protein: n.proteins_100g ?? 0,
    carbs: n.carbohydrates_100g ?? 0,
    fat: n.fat_100g ?? 0,
    fiber: n.fiber_100g ?? 0,
    sodium: Math.round((n.sodium_100g ?? 0) * 1000), // gram -> mg
    sugar: n.sugars_100g ?? 0,
    source: 'off',
  };
}

const AI_FOOD_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    servingLabel: { type: 'string' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    fiber: { type: 'number' },
    sodium: { type: 'number' },
    sugar: { type: 'number' },
  },
  required: ['name', 'calories'],
} as const;

interface AiFoodRaw {
  name?: string; servingLabel?: string;
  calories?: number; protein?: number; carbs?: number; fat?: number;
  fiber?: number; sodium?: number; sugar?: number;
}

async function estimateWithAi(env: Env, name: string): Promise<FoodResult | null> {
  let raw: AiFoodRaw | null = null;
  try {
    raw = await runJson<AiFoodRaw>(
      env,
      [
        {
          role: 'system',
          content: 'Kamu ahli gizi Indonesia. Estimasi kandungan gizi untuk satu porsi lazim rumah tangga dari makanan yang disebut. Angka harus realistis untuk makanan pada umumnya, bukan produk kemasan bermerek spesifik. Semua teks Bahasa Indonesia.',
        },
        { role: 'user', content: `Estimasi gizi per porsi untuk: "${name}"` },
      ],
      AI_FOOD_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 400 }
    );
  } catch (err) {
    console.error('Food AI estimate failed', err);
    return null;
  }
  if (!raw?.name || typeof raw.calories !== 'number') return null;

  return {
    name: raw.name.trim(),
    brand: null,
    servingSize: raw.servingLabel?.trim() || null,
    calories: Math.round(raw.calories),
    protein: raw.protein ?? 0,
    carbs: raw.carbs ?? 0,
    fat: raw.fat ?? 0,
    fiber: raw.fiber ?? 0,
    sodium: raw.sodium ?? 0,
    sugar: raw.sugar ?? 0,
    source: 'ai',
  };
}

/**
 * Resolver bertingkat. Barcode dan name diselesaikan lewat jalur terpisah —
 * barcode TIDAK PERNAH jatuh ke tier AI (nomor barcode tidak berarti apa-apa
 * bagi model bahasa); kalau OFF tidak punya datanya, hasilnya null dan
 * pemanggil mengarahkan pengguna ke scan label sebagai gantinya.
 *
 *   barcode: cache-off (tier 2) -> Open Food Facts (tier 3) -> null
 *   name:    curated (tier 1) -> cache-ai (tier 2) -> AI (tier 4)
 */
export async function resolveFood(
  env: Env,
  opts: { barcode?: string; name?: string }
): Promise<FoodResult | null> {
  const barcode = opts.barcode?.trim();
  const name = opts.name?.trim();

  if (barcode) {
    const cached = await getCached(env.DB, 'off', barcode);
    if (cached) return cacheRowToResult(cached, 'cache-off');

    const off = await fetchOpenFoodFacts(barcode);
    if (off) {
      await putCache(env.DB, 'off', barcode, off);
      return off;
    }
    return null;
  }

  if (name) {
    const curated = searchCuratedFoods(name).find(f => f.name.toLowerCase() === name.toLowerCase());
    if (curated) return curatedToResult(curated);

    const lookupKey = normalizeLookupKey(name);
    const cached = await getCached(env.DB, 'ai', lookupKey);
    if (cached) return cacheRowToResult(cached, 'cache-ai');

    const ai = await estimateWithAi(env, name);
    if (ai) {
      await putCache(env.DB, 'ai', lookupKey, ai);
      return ai;
    }
  }

  return null;
}

// GET /api/food/search?q=  — tier 1 (kurasi) + tier 2 (cache-ai), TANPA AI dan TANPA fetch
// jaringan. Untuk autocomplete cepat saat mengetik.
foodSearch.get('/search', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 2) return c.json({ results: [] });

  const curated = searchCuratedFoods(q).slice(0, 10).map(curatedToResult);
  if (curated.length >= 10) return c.json({ results: curated });

  const cached = await getCached(c.env.DB, 'ai', normalizeLookupKey(q));
  const results = cached ? [...curated, cacheRowToResult(cached, 'cache-ai')] : curated;
  return c.json({ results });
});

// POST /api/food/lookup — { barcode? , name? } — rantai resolver penuh.
foodSearch.post('/lookup', async (c) => {
  const body = await c.req.json<{ barcode?: string; name?: string }>().catch(() => null);
  const barcode = body?.barcode?.trim();
  const name = body?.name?.trim();
  if (!barcode && !name) return c.json({ error: 'barcode atau name wajib diisi' }, 400);

  const result = await resolveFood(c.env, { barcode, name });
  if (!result) {
    return c.json(
      { error: barcode ? 'Produk tidak ditemukan, coba scan label' : 'Makanan tidak dikenali' },
      404
    );
  }
  return c.json({ food: result });
});

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    servingSize: { type: 'string' },
    servingsPerPack: { type: 'number' },
    calories: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    saturatedFat: { type: 'number' },
    fiber: { type: 'number' },
    sugar: { type: 'number' },
    sodium: { type: 'number' },
  },
  required: ['calories'],
} as const;

interface RawLabel {
  servingSize?: string;
  servingsPerPack?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  saturatedFat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

// POST /api/food/scan-label — { image } data URL panel Informasi Nilai Gizi.
//
// Panel Indonesia mencantumkan angka PER TAKARAN SAJI, dan satu kemasan
// sering berisi lebih dari satu sajian — kalau dibaca mentah lalu disimpan
// sebagai "1 porsi", user yang makan seluruh kemasan tercatat sepertiga dari
// yang sebenarnya. Makanya respons ini SELALU mengembalikan dua angka
// (per sajian, per kemasan) dan membiarkan pemanggil (frontend) memaksa
// user memilih sebelum disimpan ke log.
foodSearch.post('/scan-label', async (c) => {
  const body = await c.req.json<{ image?: string }>().catch(() => null);
  const image = body?.image?.trim();
  if (!image) return c.json({ error: 'image is required' }, 400);
  if (!image.startsWith('data:image/')) return c.json({ error: 'image must be a data URL' }, 400);
  if (image.length > 6_000_000) return c.json({ error: 'image too large' }, 413);

  let raw: RawLabel | null = null;
  try {
    raw = await runJson<RawLabel>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu membaca panel Informasi Nilai Gizi pada kemasan makanan Indonesia. Ambil angka PER TAKARAN SAJI seperti tercetak (bukan per 100g kecuali memang itu yang tercetak), takaran saji, dan jumlah sajian per kemasan kalau tercantum. Lemak jenuh dalam gram, natrium dalam miligram, sesuai satuan yang lazim tercetak di label.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Baca panel Informasi Nilai Gizi ini dan keluarkan datanya.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      LABEL_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 500 }
    );
  } catch (err) {
    console.error('Label scan failed', err);
    return c.json({ error: 'Gagal membaca label' }, 502);
  }

  if (!raw || typeof raw.calories !== 'number' || raw.calories <= 0) {
    return c.json({ error: 'Label tidak terbaca' }, 422);
  }

  const perServing: AlgNutrients = {
    calories: raw.calories,
    protein: raw.protein ?? 0,
    fat: raw.fat ?? 0,
    saturatedFat: raw.saturatedFat ?? 0,
    carbs: raw.carbs ?? 0,
    sugar: raw.sugar ?? 0,
    sodium: raw.sodium ?? 0,
  };
  const fiber = raw.fiber ?? 0;

  const percentAlg = computeAlgPercent(perServing);
  const warnings = buildWarnings(percentAlg);

  const user = c.get('user');
  const [targetRow, todayRow] = await Promise.all([
    c.env.DB.prepare('SELECT calories FROM nutrition_targets WHERE user_id = ?1').bind(user.sub).first<{ calories: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(calories), 0) as total FROM food_logs WHERE user_id = ?1 AND log_date = ?2")
      .bind(user.sub, jakartaToday()).first<{ total: number }>(),
  ]);
  const dailyTarget = targetRow?.calories ?? 2200;
  const remaining = Math.max(0, dailyTarget - (todayRow?.total ?? 0));

  let suggestion = '';
  try {
    suggestion = await runText(c.env, [
      { role: 'system', content: 'Kamu asisten gizi yang memberi satu kalimat saran singkat, suportif, dan jujur pada angka dalam Bahasa Indonesia. Tanpa markdown.' },
      {
        role: 'user',
        content: [
          `Sisa kuota kalori hari ini: ${remaining} kkal.`,
          `Produk yang baru dipindai: ${perServing.calories} kkal per sajian.`,
          warnings.length ? `Peringatan: ${warnings.join('; ')}.` : '',
          'Beri satu kalimat saran singkat.',
        ].filter(Boolean).join(' '),
      },
    ], { maxTokens: 100 });
  } catch (err) {
    console.error('Label suggestion failed', err);
    // Insight tetap berguna tanpa kalimat saran — tidak menggagalkan seluruh respons.
  }

  const perServingFull = { ...perServing, fiber };
  const perPack = raw.servingsPerPack && raw.servingsPerPack > 1
    ? scaleServing(perServingFull, raw.servingsPerPack)
    : null;

  return c.json({
    perServing: perServingFull,
    perPack,
    servingSize: raw.servingSize ?? null,
    servingsPerPack: raw.servingsPerPack ?? null,
    insight: { percentAlg, warnings, suggestion: suggestion.trim() },
  });
});

export default foodSearch;
