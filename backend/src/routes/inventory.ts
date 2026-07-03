import { Hono } from 'hono';
import type { InventoryItemRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate } from '../lib/validate';

const inventory = new Hono<AuthContext>();

inventory.use('/*', requireAuth);

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

export default inventory;
