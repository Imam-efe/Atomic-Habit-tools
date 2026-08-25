/**
 * Modul Masakan.
 *
 * Pertanyaan yang dijawab modul ini: "isi kulkas segini, bisa masak apa?" —
 * beserta apa yang kurang kalau ingin masak sesuatu yang lebih dari itu.
 * Pengguna boleh memilih sendiri bahan mana yang mau dipakai, karena
 * inventaris berisi semua yang dipunya sedangkan yang mau dimasak malam ini
 * biasanya hanya sebagian.
 *
 * Pembagian tugas dengan lib/cooking.ts dijaga ketat: berkas ini mengurus
 * database dan AI, sedangkan pemilahan "ada" dan "kurang" seluruhnya di sana
 * dan diuji tanpa keduanya.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { runJson } from '../lib/ai';
import { nanoid } from '../lib/nanoid';
import { jakartaToday } from '../lib/validate';
import {
  bacaRencana, bacaResep, ringkasStok, type RecipeSuggestion, type StockItem,
} from '../lib/cooking';
import { selisihHari } from '../lib/ai_context';
import { cacheKey, readBudget, readCache, recordCall, writeCache } from '../lib/ai_budget';
import { loadSettings, num, bool } from '../lib/settings';

const cooking = new Hono<AuthContext>();
cooking.use('/*', requireAuth);

const RESEP_SCHEMA = {
  type: 'object',
  properties: {
    resep: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nama: { type: 'string', description: 'Nama masakan Indonesia' },
          bahan: {
            type: 'array',
            items: { type: 'string' },
            description: 'Semua bahan yang dibutuhkan, termasuk yang tidak dimiliki pengguna. Satu bahan per elemen, tanpa takaran.',
          },
          langkah: { type: 'array', items: { type: 'string' }, description: 'Langkah singkat memasak' },
          menit: { type: 'number', description: 'Perkiraan waktu masak dalam menit' },
          porsi: { type: 'number', description: 'Perkiraan jumlah porsi' },
        },
        required: ['nama', 'bahan', 'langkah'],
      },
    },
  },
  required: ['resep'],
};

/** Baca stok pengguna sebagai daftar bahan beserta sisa umurnya. */
async function bacaStok(
  db: AuthContext['Bindings']['DB'],
  userId: string,
  today: string
): Promise<StockItem[]> {
  const rows = await db.prepare(
    `SELECT name, quantity, unit, expiry_date
       FROM inventory_items WHERE user_id = ?1 AND quantity > 0
      ORDER BY COALESCE(expiry_date, '9999-12-31') ASC LIMIT 100`
  ).bind(userId).all<{ name: string; quantity: number; unit: string | null; expiry_date: string | null }>();

  return (rows.results ?? []).map((r) => ({
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    daysLeft: r.expiry_date ? selisihHari(today, r.expiry_date) : null,
  }));
}

// GET /api/cooking/ingredients — bahan yang bisa dicentang pengguna
cooking.get('/ingredients', async (c) => {
  const user = c.get('user');
  const stok = await bacaStok(c.env.DB, user.sub, jakartaToday());
  return c.json({ ingredients: stok });
});

// POST /api/cooking/suggest — saran masakan dari bahan terpilih
cooking.post('/suggest', async (c) => {
  const user = c.get('user');
  type Body = { ingredients?: string[]; craving?: string; extra?: string[] };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const today = jakartaToday();
  const semua = await bacaStok(c.env.DB, user.sub, today);

  // Bahan tambahan yang diketik pengguna tapi belum tercatat di inventaris.
  // Dianggap dimiliki, karena pengguna baru saja mengatakan ia punya.
  const extra = Array.isArray(body.extra)
    ? body.extra
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 20)
    : [];

  // Tanpa pilihan sama sekali, seluruh isi inventaris dipakai. Begitu pengguna
  // memilih — lewat centang ATAU lewat ketikan — hanya itu yang dipakai:
  // mencentang nol barang lalu mengetik "tempe" berarti "pakai tempe saja",
  // dan mengembalikan resep dari seluruh isi kulkas bukan jawabannya.
  const memilih = (Array.isArray(body.ingredients) && body.ingredients.length > 0) || extra.length > 0;
  const dipilih = new Set(
    (Array.isArray(body.ingredients) ? body.ingredients : [])
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
  );

  let stok = memilih ? semua.filter((s) => dipilih.has(s.name.toLowerCase())) : semua;
  for (const nama of extra) {
    if (!stok.some((s) => s.name.toLowerCase() === nama.toLowerCase())) {
      stok = [...stok, { name: nama, quantity: 1, unit: null, daysLeft: null }];
    }
  }

  if (stok.length === 0) {
    return c.json({
      recipes: [],
      message: 'Belum ada bahan yang bisa dipakai. Tambahkan stok di Inventaris atau ketik bahan yang kamu punya.',
    });
  }

  const craving = typeof body.craving === 'string' ? body.craving.trim().slice(0, 200) : '';
  const daftarBahan = ringkasStok(stok);

  const settings = await loadSettings(c.env.DB, user.sub);
  const budget = await readBudget(c.env.DB, user.sub, today, num(settings, 'ai.daily_limit'));
  if (budget.exhausted) {
    return c.json({ error: 'jatah AI habis', message: budget.notice }, 429);
  }

  // Saran masakan adalah pertanyaan, bukan aksi — aman dipakai ulang. Kuncinya
  // menyertakan daftar bahan, jadi begitu isi kulkas berubah jawabannya
  // dihitung ulang.
  const kunci = bool(settings, 'ai.cache_enabled')
    ? await cacheKey([user.sub, 'masakan', craving, daftarBahan])
    : null;

  if (kunci) {
    const cached = await readCache<{ recipes: RecipeSuggestion[] }>(c.env.DB, user.sub, kunci);
    if (cached) {
      return c.json({
        recipes: cached.recipes,
        usedIngredients: stok.map((s) => s.name),
        sisa: budget.remaining,
        catatanKuota: budget.notice,
        dariSimpanan: true,
      });
    }
  }

  let raw: unknown;
  try {
    raw = await runJson<Record<string, unknown>>(
      c.env,
      [
        {
          role: 'system',
          content: `Kamu juru masak rumahan Indonesia. Usulkan 3 masakan dari bahan yang dimiliki pengguna.

Aturan:
- Sebutkan SEMUA bahan yang dibutuhkan tiap resep, termasuk yang tidak dimiliki pengguna. Aplikasi yang akan memilah mana yang ada dan mana yang harus dibeli.
- Utamakan resep yang memakai bahan yang sisa umurnya sedikit.
- Minimal satu resep harus bisa dimasak tanpa belanja sama sekali kalau memungkinkan.
- Bumbu dapur biasa (garam, minyak, gula, merica) boleh disebut sebagai bahan.
- Langkah singkat saja, tiga sampai enam langkah.`,
        },
        {
          role: 'user',
          content: `Bahan yang saya punya:\n${daftarBahan}${craving ? `\n\nSaya sedang ingin: ${craving}` : ''}`,
        },
      ],
      RESEP_SCHEMA,
      { maxTokens: 1200 }
    );
  } catch (err) {
    console.error('[cooking] AI gagal', err);
    return c.json({ error: 'AI sedang tidak bisa dihubungi' }, 503);
  }

  await recordCall(c.env.DB, user.sub, today);

  const recipes: RecipeSuggestion[] = bacaResep(raw, stok);
  if (recipes.length === 0) {
    return c.json({ error: 'AI tidak memberi resep yang bisa dibaca' }, 502);
  }

  if (kunci) await writeCache(c.env.DB, user.sub, kunci, { recipes });

  return c.json({
    recipes,
    usedIngredients: stok.map((s) => s.name),
    sisa: Math.max(0, budget.remaining - 1),
    catatanKuota: budget.notice,
  });
});

const RENCANA_SCHEMA = {
  type: 'object',
  properties: {
    rencana: {
      type: 'array',
      description: 'Tujuh masakan, satu untuk tiap hari, dimulai dari hari pertama.',
      items: {
        type: 'object',
        properties: {
          nama: { type: 'string', description: 'Nama masakan Indonesia' },
          bahan: {
            type: 'array',
            items: { type: 'string' },
            description: 'Semua bahan yang dibutuhkan, termasuk yang tidak dimiliki. Satu bahan per elemen, tanpa takaran.',
          },
          langkah: { type: 'array', items: { type: 'string' } },
          menit: { type: 'number' },
          porsi: { type: 'number' },
        },
        required: ['nama', 'bahan'],
      },
    },
  },
  required: ['rencana'],
};

// POST /api/cooking/plan — rencana tujuh hari plus satu daftar belanja
cooking.post('/plan', async (c) => {
  const user = c.get('user');
  type Body = { startDate?: string; note?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const today = jakartaToday();
  const mulai = typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
    ? body.startDate
    : today;

  const stok = await bacaStok(c.env.DB, user.sub, today);
  const daftarBahan = stok.length > 0 ? ringkasStok(stok) : '(inventaris kosong)';

  const settings = await loadSettings(c.env.DB, user.sub);
  const budget = await readBudget(c.env.DB, user.sub, today, num(settings, 'ai.daily_limit'));
  if (budget.exhausted) return c.json({ error: 'jatah AI habis', message: budget.notice }, 429);

  const catatan = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

  const kunci = bool(settings, 'ai.cache_enabled')
    ? await cacheKey([user.sub, 'rencana', mulai, catatan, daftarBahan])
    : null;

  if (kunci) {
    const cached = await readCache<{ days: unknown[]; shoppingList: string[] }>(c.env.DB, user.sub, kunci);
    if (cached) return c.json({ ...cached, startDate: mulai, dariSimpanan: true });
  }

  let raw: unknown;
  try {
    raw = await runJson<Record<string, unknown>>(
      c.env,
      [
        {
          role: 'system',
          content: `Kamu juru masak rumahan Indonesia. Susun rencana makan tujuh hari.

Aturan:
- Tepat tujuh masakan, satu per hari, berurutan mulai hari pertama.
- Sebutkan SEMUA bahan tiap resep, termasuk yang tidak dimiliki pengguna. Aplikasi yang memilah mana yang ada dan mana yang harus dibeli.
- Utamakan hari-hari awal memakai bahan yang sisa umurnya sedikit, supaya tidak terbuang.
- Pakai bahan yang sama di beberapa hari kalau masuk akal — belanja jadi lebih sedikit dan tidak ada sisa yang menganggur.
- Variasikan jenis masakannya; jangan tujuh hari berturut-turut yang mirip.
- Langkah singkat, tiga sampai lima langkah.`,
        },
        {
          role: 'user',
          content: `Bahan yang saya punya:\n${daftarBahan}${catatan ? `\n\nCatatan: ${catatan}` : ''}`,
        },
      ],
      RENCANA_SCHEMA,
      { maxTokens: 2000 }
    );
  } catch (err) {
    console.error('[cooking] AI rencana gagal', err);
    return c.json({ error: 'AI sedang tidak bisa dihubungi' }, 503);
  }

  await recordCall(c.env.DB, user.sub, today);

  const { days, shoppingList } = bacaRencana(raw, stok, mulai);
  if (days.length === 0) return c.json({ error: 'AI tidak memberi rencana yang bisa dibaca' }, 502);

  if (kunci) await writeCache(c.env.DB, user.sub, kunci, { days, shoppingList });

  return c.json({
    days, shoppingList, startDate: mulai,
    sisa: Math.max(0, budget.remaining - 1),
    catatanKuota: budget.notice,
  });
});

// POST /api/cooking/plan/shop — satu tugas belanja untuk seluruh rencana
cooking.post('/plan/shop', async (c) => {
  const user = c.get('user');
  type Body = { items?: string[]; date?: string };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const items = Array.isArray(body.items)
    ? body.items
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim().slice(0, 80))
        .slice(0, 60)
    : [];

  if (items.length === 0) return c.json({ error: 'tidak ada bahan yang perlu dibeli' }, 400);

  const today = jakartaToday();
  const tanggal = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : today;

  // Satu tugas untuk seluruh minggu, bukan tujuh: itulah gunanya
  // merencanakan sekaligus.
  const eventId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO calendar_events
       (id, user_id, title, note, kind, event_date, is_done, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'task', ?5, 0, ?6, ?6)`
  ).bind(
    eventId, user.sub,
    `Belanja mingguan (${items.length} bahan)`,
    items.join(', ').slice(0, 2000),
    tanggal, now
  ).run();

  return c.json({ ok: true, eventId, items });
});

// GET /api/cooking/recipes — resep yang disimpan
cooking.get('/recipes', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT id, name, have_json, missing_json, steps_json, minutes, servings, note,
            last_cooked_date, cooked_count
       FROM cooking_recipes WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100`
  ).bind(user.sub).all<{
    id: string; name: string; have_json: string; missing_json: string; steps_json: string;
    minutes: number | null; servings: number | null; note: string | null;
    last_cooked_date: string | null; cooked_count: number;
  }>();

  const parse = (s: string): string[] => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };

  return c.json({
    recipes: (rows.results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      have: parse(r.have_json),
      missing: parse(r.missing_json),
      steps: parse(r.steps_json),
      minutes: r.minutes,
      servings: r.servings,
      note: r.note,
      lastCookedDate: r.last_cooked_date,
      cookedCount: r.cooked_count,
    })),
  });
});

// POST /api/cooking/recipes — simpan satu resep
cooking.post('/recipes', async (c) => {
  const user = c.get('user');
  type Body = {
    name?: string; have?: string[]; missing?: string[]; steps?: string[];
    minutes?: number; servings?: number; note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const name = body.name?.trim();
  if (!name) return c.json({ error: 'nama resep wajib diisi' }, 400);

  const list = (v: unknown, max: number): string =>
    JSON.stringify(
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
           .map((x) => x.trim().slice(0, 300)).slice(0, max)
        : []
    );

  const id = nanoid();
  await c.env.DB.prepare(
    `INSERT INTO cooking_recipes
       (id, user_id, name, have_json, missing_json, steps_json, minutes, servings, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    id, user.sub, name.slice(0, 120),
    list(body.have, 20), list(body.missing, 20), list(body.steps, 12),
    typeof body.minutes === 'number' && body.minutes > 0 ? Math.round(body.minutes) : null,
    typeof body.servings === 'number' && body.servings > 0 ? Math.round(body.servings) : null,
    body.note?.trim().slice(0, 500) || null
  ).run();

  return c.json({ id, ok: true }, 201);
});

// DELETE /api/cooking/recipes/:id
cooking.delete('/recipes/:id', async (c) => {
  const user = c.get('user');
  const res = await c.env.DB.prepare(
    'DELETE FROM cooking_recipes WHERE id = ?1 AND user_id = ?2'
  ).bind(c.req.param('id'), user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'resep tidak ditemukan' }, 404);
  return c.json({ ok: true });
});

// POST /api/cooking/recipes/:id/cook — tandai sudah dimasak, kurangi stok
cooking.post('/recipes/:id/cook', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    used?: Array<{ name?: string; quantity?: number }>;
    /** Kalau diisi, porsinya ikut dicatat ke log makan. */
    meal?: { portion?: string; calories?: number; protein?: number; label?: string };
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const recipe = await c.env.DB.prepare(
    'SELECT id, name FROM cooking_recipes WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<{ id: string; name: string }>();
  if (!recipe) return c.json({ error: 'resep tidak ditemukan' }, 404);

  const today = jakartaToday();

  // Jumlah yang dipakai datang dari pengguna, tidak ditebak dari resep:
  // resep menyebut "bawang merah" tanpa takaran, dan menebak angka lalu
  // mengurangi stok orang dengan angka itu adalah kesalahan yang diam.
  const statements = [
    c.env.DB.prepare(
      `UPDATE cooking_recipes
          SET cooked_count = cooked_count + 1, last_cooked_date = ?1
        WHERE id = ?2 AND user_id = ?3`
    ).bind(today, id, user.sub),
  ];

  const dikurangi: string[] = [];
  for (const item of Array.isArray(body.used) ? body.used.slice(0, 20) : []) {
    const nama = typeof item?.name === 'string' ? item.name.trim() : '';
    const jumlah = typeof item?.quantity === 'number' && item.quantity > 0 ? item.quantity : 0;
    if (!nama || jumlah === 0) continue;

    // Barisnya dicari dulu lalu dikurangi lewat id.
    //
    // Nama barang tidak unik — belanja dua kali menghasilkan dua baris "Telur"
    // dengan tanggal kedaluwarsa berbeda, dan itu memang wajar. UPDATE yang
    // menyaring dengan nama akan mengurangi jumlah yang sama dari SEMUA baris
    // itu sekaligus: memakai tiga telur menghapus enam.
    //
    // Yang paling dekat kedaluwarsa yang dipakai, karena itu juga yang
    // sungguhan diambil orang dari kulkas lebih dulu.
    const baris = await c.env.DB.prepare(
      `SELECT id FROM inventory_items
        WHERE user_id = ?1 AND LOWER(name) = LOWER(?2) AND quantity > 0
        ORDER BY COALESCE(expiry_date, '9999-12-31') ASC LIMIT 1`
    ).bind(user.sub, nama).first<{ id: string }>();
    if (!baris) continue;

    dikurangi.push(nama);
    // MAX(0, ...) dihitung di SQL, bukan dari angka yang dibaca lebih dulu:
    // stok tidak pernah minus, dan dua masak yang tercatat hampir bersamaan
    // tidak saling menimpa hasil.
    statements.push(
      c.env.DB.prepare(
        `UPDATE inventory_items SET quantity = MAX(0, quantity - ?1)
          WHERE id = ?2 AND user_id = ?3`
      ).bind(jumlah, baris.id, user.sub)
    );
  }

  /**
   * Masak lalu makan adalah satu peristiwa, bukan dua.
   *
   * Selama ini pengguna harus mencatatnya dua kali: sekali di Masakan supaya
   * stoknya berkurang, sekali lagi di Nutrisi supaya kalorinya terhitung. Yang
   * kedua hampir selalu terlewat, dan log makan jadi bolong justru di hari
   * pengguna benar-benar memasak.
   *
   * Angka gizinya datang dari pengguna atau dari AI di layar, tidak ditebak di
   * sini — resep tidak menyimpan gizi, dan mengarang kalori lebih buruk
   * daripada tidak mencatat.
   */
  let mealLogged = false;
  const meal = body.meal;
  if (meal && (typeof meal.calories === 'number' || typeof meal.portion === 'string')) {
    const angka = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO food_logs (id, user_id, food_name, portion, calories, protein_g, label, log_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      ).bind(
        nanoid(), user.sub, recipe.name.slice(0, 120),
        typeof meal.portion === 'string' && meal.portion.trim() ? meal.portion.trim().slice(0, 60) : null,
        angka(meal.calories), angka(meal.protein),
        typeof meal.label === 'string' && meal.label.trim() ? meal.label.trim().slice(0, 30) : null,
        today
      )
    );
    mealLogged = true;
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, date: today, adjusted: dikurangi, mealLogged });
});

// POST /api/cooking/recipes/:id/shop — bahan kurang jadi tugas belanja
cooking.post('/recipes/:id/shop', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const recipe = await c.env.DB.prepare(
    'SELECT name, missing_json FROM cooking_recipes WHERE id = ?1 AND user_id = ?2'
  ).bind(id, user.sub).first<{ name: string; missing_json: string }>();
  if (!recipe) return c.json({ error: 'resep tidak ditemukan' }, 404);

  let missing: string[] = [];
  try {
    const v = JSON.parse(recipe.missing_json);
    if (Array.isArray(v)) missing = v.filter((x): x is string => typeof x === 'string');
  } catch {
    missing = [];
  }

  if (missing.length === 0) return c.json({ error: 'tidak ada bahan yang kurang' }, 400);

  // Masuk ke kalender sebagai tugas, bukan ke inventaris sebagai barang
  // berjumlah nol: yang belum dibeli bukan stok, dan menaruhnya di inventaris
  // membuat semua hitungan yang berdiri di atas stok jadi bohong.
  const eventId = nanoid();
  const now = Math.floor(Date.now() / 1000);
  const today = jakartaToday();

  await c.env.DB.prepare(
    `INSERT INTO calendar_events
       (id, user_id, title, note, kind, event_date, is_done, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'task', ?5, 0, ?6, ?6)`
  ).bind(
    eventId, user.sub,
    `Belanja bahan: ${recipe.name}`.slice(0, 200),
    missing.join(', ').slice(0, 500),
    today, now
  ).run();

  return c.json({ ok: true, eventId, missing });
});

export default cooking;
