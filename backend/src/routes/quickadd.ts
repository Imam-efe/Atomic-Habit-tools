import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { runJson, SCHEMA_MODEL } from '../lib/ai';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './budget';
import { PLANT_BY_ID } from '../data/plants';
import { jakartaToday } from '../lib/validate';

const quickadd = new Hono<AuthContext>();
quickadd.use('/*', requireAuth);

/**
 * Quick-add parses a sentence ("beli kopi 25rb pakai BCA") into a proposed
 * record. It deliberately does NOT write anything: an extraction model is
 * occasionally wrong, and silently posting a wrong number into a finance
 * ledger is worse than typing it by hand. The frontend shows the proposal in
 * an editable confirm card and commits through the existing validated
 * /budget, /habits/:id/toggle and /inventory endpoints.
 */

type Intent = 'expense' | 'income' | 'habit' | 'inventory' | 'calendar' | 'garden' | 'unknown';

/** Aksi perawatan kebun yang bisa dicatat lewat kalimat. */
const GARDEN_ACTIONS = ['siram', 'pupuk', 'panen', 'pangkas', 'semprot'] as const;

interface RawParse {
  intent?: string;
  amount?: number;
  category?: string;
  note?: string;
  habit_name?: string;
  item_name?: string;
  quantity?: number;
  unit?: string;
  bank_hint?: string;
  calendar_title?: string;
  calendar_date?: string;
  calendar_time?: string;
  calendar_kind?: string;
  garden_action?: string;
  garden_plant?: string;
  garden_amount?: number;
  garden_unit?: string;
}

const CALENDAR_KINDS = ['task', 'event', 'reminder'] as const;

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['expense', 'income', 'habit', 'inventory', 'calendar', 'garden', 'unknown'],
      description: 'expense/income untuk transaksi uang, habit kalau menyelesaikan kebiasaan, inventory kalau menambah stok barang, calendar kalau menjadwalkan sesuatu di masa depan, garden kalau merawat tanaman di kebun (menyiram, memupuk, memanen)',
    },
    amount: { type: 'number', description: 'Nominal rupiah, angka penuh tanpa titik. 25rb = 25000' },
    category: { type: 'string', description: 'Salah satu kategori dari daftar yang diberikan' },
    note: { type: 'string', description: 'Deskripsi singkat, misal nama barang atau sumber pemasukan' },
    habit_name: { type: 'string', description: 'Nama kebiasaan yang disebutkan, hanya untuk intent habit' },
    item_name: { type: 'string', description: 'Nama barang, hanya untuk intent inventory' },
    quantity: { type: 'number', description: 'Jumlah barang, hanya untuk intent inventory' },
    unit: { type: 'string', description: 'Satuan barang, misal kg/pcs/liter' },
    bank_hint: { type: 'string', description: 'Nama rekening/bank yang disebutkan, kosongkan kalau tidak ada' },
    calendar_title: { type: 'string', description: 'Judul acara/tugas/pengingat, hanya untuk intent calendar' },
    calendar_date: { type: 'string', description: 'Tanggal dalam format YYYY-MM-DD, dihitung dari tanggal hari ini yang diberikan. Hanya untuk intent calendar' },
    calendar_time: { type: 'string', description: 'Jam dalam format HH:MM 24 jam, kosongkan kalau tidak disebutkan. Hanya untuk intent calendar' },
    calendar_kind: { type: 'string', enum: CALENDAR_KINDS, description: 'task untuk hal yang harus dikerjakan, event untuk acara, reminder untuk pengingat. Hanya untuk intent calendar' },
    garden_action: { type: 'string', enum: GARDEN_ACTIONS, description: 'Perawatan yang dilakukan. Hanya untuk intent garden' },
    garden_plant: { type: 'string', description: 'Nama tanaman yang dirawat. Hanya untuk intent garden' },
    garden_amount: { type: 'number', description: 'Jumlah hasil panen, hanya diisi untuk garden_action panen' },
    garden_unit: { type: 'string', description: 'Satuan hasil panen, misal kg/ikat/buah. Hanya untuk garden_action panen' },
  },
  required: ['intent'],
} as const;

/**
 * Indonesian money shorthand, resolved deterministically.
 *
 * Small models are unreliable at "1,5jt" → 1500000, and an off-by-1000 in a
 * ledger is the one error worth engineering away. A regex hit that carries an
 * explicit money marker therefore overrides whatever the model reported;
 * without a marker ("beli beras 5kg") the model's reading is left alone so a
 * quantity never gets mistaken for a price.
 */
export function parseAmountIDR(text: string): number | null {
  const lower = text.toLowerCase();
  // Number, then an optional multiplier suffix. The trailing \b matters: it
  // stops the "k" in "beli beras 5 kg" from reading as 5.000.
  const re = /(?:rp\s*)?(\d+(?:[.,]\d+)*)\s*(jt|juta|rb|ribu|k)?\b/g;
  let best: number | null = null;

  for (const m of lower.matchAll(re)) {
    const [full, digits, suffix] = m;
    const hasRp = full.trimStart().startsWith('rp');
    if (!suffix && !hasRp) continue;

    let value: number;
    if (suffix) {
      // With a multiplier the separator is a decimal point: "1,5jt" = 1.5 juta.
      value = parseFloat(digits.replace(',', '.').replace(/\.(?=\d{3}\b)/g, ''));
      if (isNaN(value)) continue;
      value *= suffix === 'jt' || suffix === 'juta' ? 1_000_000 : 1_000;
    } else {
      // Bare "Rp70.000" — separators are thousands grouping.
      value = parseInt(digits.replace(/[.,]/g, ''), 10);
      if (isNaN(value)) continue;
    }

    if (value > 0 && (best === null || value > best)) best = Math.round(value);
  }

  return best;
}

/** Fuzzy-match a spoken habit name against the user's actual habits. */
export function matchHabit<T extends { id: string; name: string }>(
  habits: T[],
  spoken: string | undefined
): T | null {
  if (!spoken) return null;
  const needle = spoken.toLowerCase().trim();
  if (!needle) return null;

  const exact = habits.find(h => h.name.toLowerCase() === needle);
  if (exact) return exact;

  const contains = habits.find(
    h => h.name.toLowerCase().includes(needle) || needle.includes(h.name.toLowerCase())
  );
  if (contains) return contains;

  // Fall back to the habit sharing the most words, so "olahraga pagi" still
  // finds "Olahraga" when the user adds a qualifier the habit name lacks.
  const needleWords = new Set(needle.split(/\s+/).filter(w => w.length > 2));
  let best: T | null = null;
  let bestScore = 0;
  for (const h of habits) {
    const score = h.name
      .toLowerCase()
      .split(/\s+/)
      .filter(w => needleWords.has(w)).length;
    if (score > bestScore) {
      best = h;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Snap a model-invented category onto the closest real one. */
function normalizeCategory(raw: string | undefined, valid: string[]): string {
  if (!raw) return valid[valid.length - 1];
  const lower = raw.toLowerCase().trim();
  const exact = valid.find(c => c.toLowerCase() === lower);
  if (exact) return exact;
  const partial = valid.find(
    c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase().split(' ')[0])
  );
  return partial ?? valid[valid.length - 1];
}

// POST /api/quickadd/parse — { text } → an editable proposal, nothing written
quickadd.post('/parse', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ text?: string }>().catch(() => null);
  const text = body?.text?.trim();
  if (!text) return c.json({ error: 'text is required' }, 400);
  if (text.length > 500) return c.json({ error: 'text too long' }, 400);

  const [habitsRes, banksRes, plantingsRes] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM habits WHERE user_id = ?1')
      .bind(user.sub).all<{ id: string; name: string }>(),
    c.env.DB.prepare('SELECT id, name FROM bank_accounts WHERE user_id = ?1')
      .bind(user.sub).all<{ id: string; name: string }>(),
    c.env.DB.prepare(
      `SELECT id, nickname, custom_name, plant_id FROM garden_plantings
        WHERE user_id = ?1 AND status IN ('tumbuh', 'panen')`
    ).bind(user.sub).all<{
      id: string; nickname: string | null; custom_name: string | null; plant_id: string | null;
    }>(),
  ]);
  const habits = habitsRes.results ?? [];
  const banks = banksRes.results ?? [];

  // Nama tanaman untuk pencocokan: julukan dulu, lalu nama katalog, terakhir
  // nama kustom. Urutan ini meniru layar Kebun supaya "siram si merah" cocok
  // dengan julukan yang dipakai pengguna sehari-hari, bukan nama botani yang
  // tidak pernah dia sebut. Katalog ada di kode, bukan DB, jadi diresolusi di
  // sini — bukan lewat JOIN yang hanya mengenal cache AI.
  const plantings = (plantingsRes.results ?? [])
    .map((p) => ({
      id: p.id,
      name: p.nickname?.trim()
        || (p.plant_id ? PLANT_BY_ID.get(p.plant_id)?.name : undefined)
        || p.custom_name?.trim()
        || '',
    }))
    .filter((p) => p.name.length > 0);

  let parsed: RawParse | null = null;
  try {
    parsed = await runJson<RawParse>(
      c.env,
      [
        {
          role: 'system',
          content: [
            'Kamu parser input bahasa Indonesia untuk aplikasi pencatatan harian. Ubah kalimat pengguna jadi satu objek terstruktur.',
            `Kategori pengeluaran yang valid: ${EXPENSE_CATEGORIES.join(', ')}.`,
            `Kategori pemasukan yang valid: ${INCOME_CATEGORIES.join(', ')}.`,
            habits.length > 0
              ? `Kebiasaan milik pengguna: ${habits.map(h => h.name).join(', ')}.`
              : 'Pengguna belum punya kebiasaan terdaftar.',
            banks.length > 0 ? `Rekening pengguna: ${banks.map(b => b.name).join(', ')}.` : '',
            'Nominal selalu angka penuh dalam rupiah: "25rb" jadi 25000, "1,5jt" jadi 1500000.',
            `Hari ini tanggal ${jakartaToday()}. Untuk intent calendar, hitung calendar_date dari tanggal ini — "besok" berarti hari ini + 1 hari, "minggu depan" + 7 hari, dst.`,
            'Kalau kalimat tidak jelas maksudnya, pakai intent "unknown".',
          ].filter(Boolean).join(' '),
        },
        { role: 'user', content: text },
      ],
      PARSE_SCHEMA as unknown as Record<string, unknown>,
      { maxTokens: 300 }
    );
  } catch (err) {
    console.error('Quick-add parse failed', err);
    return c.json({ error: 'AI parse failed' }, 502);
  }

  if (!parsed) return c.json({ intent: 'unknown' as Intent, text });

  const KNOWN_INTENTS = ['expense', 'income', 'habit', 'inventory', 'calendar', 'garden'] as const;
  const intent: Intent = (KNOWN_INTENTS as readonly string[]).includes(parsed.intent ?? '')
    ? (parsed.intent as Intent)
    : 'unknown';

  if (intent === 'garden') {
    const planting = matchHabit(plantings, parsed.garden_plant ?? text);
    // Tanpa tanaman yang cocok tidak ada yang bisa dicatat — lebih baik jatuh
    // ke unknown daripada menebak tanaman mana yang dimaksud.
    if (!planting) return c.json({ intent: 'unknown' as Intent, text });

    const action = (GARDEN_ACTIONS as readonly string[]).includes(parsed.garden_action ?? '')
      ? parsed.garden_action!
      : 'siram';

    // Jumlah hanya bermakna untuk panen; untuk siram/pupuk angka di kalimat
    // biasanya bagian dari nama atau jumlah tanaman, bukan hasil.
    const amount = action === 'panen' && parsed.garden_amount && parsed.garden_amount > 0
      ? parsed.garden_amount
      : null;

    return c.json({
      intent,
      text,
      care: {
        plantingId: planting.id,
        plantName: planting.name,
        action,
        amount,
        unit: amount !== null ? (parsed.garden_unit?.trim() || 'kg') : null,
      },
    });
  }

  if (intent === 'habit') {
    const habit = matchHabit(habits, parsed.habit_name ?? text);
    if (!habit) return c.json({ intent: 'unknown' as Intent, text });
    return c.json({ intent, text, habit: { id: habit.id, name: habit.name } });
  }

  if (intent === 'inventory') {
    return c.json({
      intent,
      text,
      item: {
        name: parsed.item_name ?? parsed.note ?? text,
        quantity: parsed.quantity && parsed.quantity > 0 ? parsed.quantity : 1,
        unit: parsed.unit ?? 'pcs',
      },
    });
  }

  if (intent === 'calendar') {
    const title = parsed.calendar_title?.trim() || text;
    const dateOk = parsed.calendar_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.calendar_date)
      && parsed.calendar_date >= jakartaToday();
    if (!dateOk) return c.json({ intent: 'unknown' as Intent, text });

    const time = parsed.calendar_time && /^\d{2}:\d{2}$/.test(parsed.calendar_time)
      ? parsed.calendar_time
      : null;
    const kind = CALENDAR_KINDS.includes(parsed.calendar_kind as (typeof CALENDAR_KINDS)[number])
      ? parsed.calendar_kind!
      : 'task';

    return c.json({
      intent,
      text,
      event: {
        title,
        note: parsed.note ?? null,
        kind,
        event_date: parsed.calendar_date,
        event_time: time,
      },
    });
  }

  if (intent === 'expense' || intent === 'income') {
    const regexAmount = parseAmountIDR(text);
    const amount = regexAmount ?? (parsed.amount && parsed.amount > 0 ? Math.round(parsed.amount) : null);
    if (!amount) return c.json({ intent: 'unknown' as Intent, text });

    const validCategories = intent === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    const bank = parsed.bank_hint
      ? banks.find(b => b.name.toLowerCase().includes(parsed!.bank_hint!.toLowerCase().trim()))
      : undefined;

    return c.json({
      intent,
      text,
      entry: {
        type: intent,
        amount,
        category: normalizeCategory(parsed.category, validCategories),
        note: parsed.note ?? text,
        date: jakartaToday(),
        bank_account_id: bank?.id ?? null,
        bank_name: bank?.name ?? null,
      },
    });
  }

  return c.json({ intent: 'unknown' as Intent, text });
});

interface RawReceipt {
  total?: number;
  merchant?: string;
  category?: string;
  date?: string;
  items?: { name?: string; quantity?: number; unit?: string }[];
}

const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'number', description: 'Total akhir yang dibayar, angka penuh rupiah' },
    merchant: { type: 'string', description: 'Nama toko atau merchant' },
    category: { type: 'string', description: 'Salah satu kategori pengeluaran dari daftar' },
    date: { type: 'string', description: 'Tanggal struk format YYYY-MM-DD, kosongkan kalau tidak terbaca' },
    items: {
      type: 'array',
      description: 'Barang yang dibeli',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  required: ['total'],
} as const;

// POST /api/quickadd/receipt — { image } data URL → a proposed expense + item list
//
// `receipt_img` was already being stored as a dead thumbnail; this reads it.
// Like /parse, nothing is written — the frontend prefills the expense form.
quickadd.post('/receipt', async (c) => {
  const body = await c.req.json<{ image?: string }>().catch(() => null);
  const image = body?.image?.trim();
  if (!image) return c.json({ error: 'image is required' }, 400);
  if (!image.startsWith('data:image/')) {
    return c.json({ error: 'image must be a data URL' }, 400);
  }
  // Base64 inflates by ~4/3, so this caps the original at roughly 4 MB.
  if (image.length > 6_000_000) return c.json({ error: 'image too large' }, 413);

  let parsed: RawReceipt | null = null;
  try {
    parsed = await runJson<RawReceipt>(
      c.env,
      [
        {
          role: 'system',
          content: `Kamu membaca struk belanja Indonesia. Ambil total akhir yang dibayar (bukan subtotal, bukan kembalian), nama toko, tanggal, dan daftar barang. Pilih kategori dari daftar ini: ${EXPENSE_CATEGORIES.join(', ')}. Nominal berupa angka penuh tanpa titik.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Baca struk ini dan keluarkan datanya.' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      RECEIPT_SCHEMA as unknown as Record<string, unknown>,
      { model: SCHEMA_MODEL, maxTokens: 800 }
    );
  } catch (err) {
    console.error('Receipt OCR failed', err);
    return c.json({ error: 'Receipt OCR failed' }, 502);
  }

  if (!parsed || !parsed.total || parsed.total <= 0) {
    return c.json({ error: 'Struk tidak terbaca' }, 422);
  }

  const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : jakartaToday();

  return c.json({
    entry: {
      type: 'expense',
      amount: Math.round(parsed.total),
      category: normalizeCategory(parsed.category, EXPENSE_CATEGORIES),
      note: parsed.merchant ?? 'Struk belanja',
      date,
    },
    items: (parsed.items ?? [])
      .filter(i => i.name)
      .slice(0, 20)
      .map(i => ({
        name: i.name!,
        quantity: i.quantity && i.quantity > 0 ? i.quantity : 1,
        unit: i.unit ?? 'pcs',
      })),
  });
});

export default quickadd;
