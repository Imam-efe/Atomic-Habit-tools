import { Hono } from 'hono';
import type { InventoryItemRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, jakartaToday } from '../lib/validate';
import { runJson } from '../lib/ai';

const inventory = new Hono<AuthContext>();

inventory.use('/*', requireAuth);

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// GET /api/inventory
inventory.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM inventory_items WHERE user_id = ?1 ORDER BY expiry_date ASC, name ASC`
  ).bind(user.sub).all<InventoryItemRow>();

  return c.json(rows.results ?? []);
});

// POST /api/inventory
inventory.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    name?: string;
    quantity?: number;
    unit?: string;
    expiry_date?: string;
    purchase_date?: string;
    category?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const quantity = body.quantity ?? 1;
  const unit = body.unit ?? 'pcs';
  const category = body.category ?? 'Bahan Makanan';
  const expiryDate = body.expiry_date || null;
  const purchaseDate = body.purchase_date || null;
  const note = body.note || null;

  await c.env.DB.prepare(
    `INSERT INTO inventory_items (id, user_id, name, quantity, unit, expiry_date, purchase_date, category, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(id, user.sub, body.name, quantity, unit, expiryDate, purchaseDate, category, note).run();

  return c.json({ id, name: body.name, quantity, unit, expiry_date: expiryDate, purchase_date: purchaseDate, category, note }, 201);
});

// PUT /api/inventory/:id
inventory.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = {
    name?: string;
    quantity?: number;
    unit?: string;
    expiry_date?: string;
    purchase_date?: string;
    category?: string;
    note?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const quantity = body.quantity ?? 1;
  const unit = body.unit ?? 'pcs';
  const category = body.category ?? 'Bahan Makanan';
  const expiryDate = body.expiry_date || null;
  const purchaseDate = body.purchase_date || null;
  const note = body.note || null;

  const res = await c.env.DB.prepare(
    `UPDATE inventory_items
     SET name = ?1, quantity = ?2, unit = ?3, expiry_date = ?4, purchase_date = ?5, category = ?6, note = ?7
     WHERE id = ?8 AND user_id = ?9`
  ).bind(body.name, quantity, unit, expiryDate, purchaseDate, category, note, id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'item not found' }, 404);

  return c.json({ id, name: body.name, quantity, unit, expiry_date: expiryDate, purchase_date: purchaseDate, category, note });
});

// DELETE /api/inventory/:id
inventory.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare(
    `DELETE FROM inventory_items WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'item not found' }, 404);

  return c.json({ ok: true });
});

interface RawShoppingList {
  suggestions?: { name: string; quantity: number; unit: string; reason: string }[];
}

const SHOPPING_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      description: 'Daftar belanja yang disarankan, satu entri per barang',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number', description: 'Jumlah yang disarankan untuk dibeli' },
          unit: { type: 'string' },
          reason: { type: 'string', description: 'Alasan singkat, mis. "stok habis" atau "kadaluarsa 2 hari lagi"' },
        },
        required: ['name', 'quantity', 'unit', 'reason'],
      },
    },
  },
  required: ['suggestions'],
} as const;

// POST /api/inventory/shopping-suggestions — AI drafts a restock list, nothing written
//
// Candidates are picked deterministically (low stock or expiring soon) so the
// model never invents an item that isn't actually running low; it only
// phrases quantities/reasons and is skipped entirely when there's nothing to
// restock, same "don't spend neurons for nothing" rule as notes summarize.
inventory.post('/shopping-suggestions', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();
  const soonCutoff = addDays(today, 3);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM inventory_items WHERE user_id = ?1 AND (quantity <= 1 OR (expiry_date IS NOT NULL AND expiry_date <= ?2))`
  ).bind(user.sub, soonCutoff).all<InventoryItemRow>();

  const candidates = rows.results ?? [];
  if (candidates.length === 0) return c.json({ suggestions: [] });

  let draft: RawShoppingList | null = null;
  try {
    draft = await runJson<RawShoppingList>(
      c.env,
      [
        {
          role: 'system',
          content: 'Kamu membantu menyusun daftar belanja dari stok rumah tangga yang menipis atau akan kadaluarsa, dalam Bahasa Indonesia. Sarankan jumlah beli yang wajar dan alasan singkat per barang. Jangan tambahkan barang di luar daftar yang diberikan.',
        },
        {
          role: 'user',
          content: candidates.map(item => {
            const days = item.expiry_date
              ? Math.round((new Date(item.expiry_date).getTime() - new Date(today).getTime()) / 86400000)
              : null;
            const status = item.quantity <= 1 ? 'stok menipis' : '';
            const expiryNote = days !== null ? (days < 0 ? 'sudah kadaluarsa' : `kadaluarsa ${days} hari lagi`) : '';
            return `- ${item.name} (sisa ${item.quantity} ${item.unit}, kategori ${item.category}${[status, expiryNote].filter(Boolean).length ? ', ' + [status, expiryNote].filter(Boolean).join(', ') : ''})`;
          }).join('\n'),
        },
      ],
      SHOPPING_SCHEMA as unknown as Record<string, unknown>,
      { maxTokens: 500 }
    );
  } catch (err) {
    console.error('Shopping suggestion failed', err);
    return c.json({ error: 'Saran belanja gagal' }, 502);
  }

  const suggestions = (draft?.suggestions ?? [])
    .filter(s => s.name?.trim())
    .map(s => ({
      name: s.name.trim(),
      quantity: Number.isFinite(s.quantity) && s.quantity > 0 ? s.quantity : 1,
      unit: s.unit?.trim() || 'pcs',
      reason: s.reason?.trim() || '',
    }))
    .slice(0, 20);

  return c.json({ suggestions });
});

export default inventory;
