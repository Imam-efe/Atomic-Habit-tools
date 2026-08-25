import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { runJson, SCHEMA_MODEL } from '../lib/ai';
import { EXPENSE_CATEGORIES } from './budget';
import { jakartaToday } from '../lib/validate';

const quickadd = new Hono<AuthContext>();
quickadd.use('/*', requireAuth);

/**
 * Sisa dari Catat Cepat: hanya pembacaan struk.
 *
 * Endpoint /parse dulu ada di sini — ia menebak maksud dari sebuah kalimat
 * lalu mengembalikan usulan yang bisa disunting. Agen mengerjakan hal yang
 * persis sama, untuk semua modul sekaligus dan dengan pembatalan, jadi
 * mempertahankan keduanya berarti dua tempat yang harus diperbaiki setiap
 * kali penebakan meleset. Overlay Catat Cepat sekarang memanggil /api/agent.
 *
 * Pembacaan struk tidak ikut pindah: ia membaca GAMBAR, bukan kalimat, dan
 * mengembalikan daftar barang belanjaan — pekerjaan yang tidak dilakukan
 * satu pun alat agen.
 */
/** Cocokkan kategori bebas dari model ke daftar kategori yang dipakai aplikasi. */
function normalizeCategory(raw: string | undefined, valid: string[]): string {
  if (!raw) return valid[valid.length - 1];
  const lower = raw.toLowerCase().trim();
  const exact = valid.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const partial = valid.find(
    (c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase().split(' ')[0])
  );
  return partial ?? valid[valid.length - 1];
}

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
