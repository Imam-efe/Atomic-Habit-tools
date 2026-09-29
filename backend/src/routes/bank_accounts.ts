import { Hono } from 'hono';
import type { BankAccountRow } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { semaiSaldoAwal, saldoSemuaRekening } from '../lib/finance_saldo';
import { validate } from '../lib/validate';

const bankAccounts = new Hono<AuthContext>();

bankAccounts.use('/*', requireAuth);

// GET /api/bank-accounts
bankAccounts.get('/', async (c) => {
  const user = c.get('user');
  const [rows, saldo] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM bank_accounts WHERE user_id = ?1 ORDER BY name ASC`
    ).bind(user.sub).all<BankAccountRow>(),
    saldoSemuaRekening(c.env.DB, user.sub),
  ]);

  // Medan `balance` sengaja dipertahankan namanya, isinya saja yang jadi
  // saldo turunan: empat layar membacanya (Uang, Pelunasan Utang, Stok, dan
  // Lainnya), dan mengganti nama medan berarti mengubah keempatnya tanpa ada
  // yang bertambah benar. Urutan nama A-Z juga dipertahankan — daftar rekening
  // dibaca untuk dicari, bukan diperingkat.
  const hitung = new Map(saldo.map((r) => [r.bankAccountId, r]));

  return c.json((rows.results ?? []).map((r) => {
    const h = hitung.get(r.id);
    return {
      ...r,
      balance: h?.saldo ?? r.balance,
      // Kolom lama masih dipelihara dua belas jalur tulis, dan tidak ada lagi
      // yang membacanya untuk kebenaran — jadi ia sekarang berfungsi sebagai
      // checksum: hitungan kedua yang independen dan seharusnya selalu cocok.
      // Nilai bukan-nol berarti ada jalur tulis yang menggeser salah satunya
      // tanpa menggeser yang lain, yaitu bug di kode ini. Dikirim supaya bisa
      // terlihat; tanpa ada yang melihatnya, checksum tidak menjaga apa pun.
      saldo_selisih: h?.selisih ?? 0,
    };
  }));
});

// POST /api/bank-accounts
bankAccounts.post('/', async (c) => {
  const user = c.get('user');
  type Body = { name?: string; account_type?: string; balance?: number };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const id = nanoid();
  const accountType = body.account_type ?? 'Bank';
  const balance = Math.round(body.balance ?? 0);

  await c.env.DB.prepare(
    `INSERT INTO bank_accounts (id, user_id, name, account_type, balance)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  ).bind(id, user.sub, body.name, accountType, balance).run();

  // Saldo yang baru diketik ini adalah titik awalnya. Dikunci sekarang juga,
  // supaya transaksi pertama menggesernya alih-alih terserap ke dalamnya:
  // penyemaian menurunkan titik awal dari (saldo - mutasi), jadi kalau
  // ditunda sampai sesudah ada transaksi, transaksi itu ikut terkurangi dan
  // efeknya hilang tanpa jejak. Lihat lib/finance_saldo.ts.
  await semaiSaldoAwal(c.env.DB, user.sub);

  return c.json({ id, name: body.name, account_type: accountType, balance }, 201);
});

// PUT /api/bank-accounts/:id
bankAccounts.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  type Body = { name?: string; account_type?: string; balance?: number };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, { name: { type: 'string' } });
  if (err) return c.json({ error: err }, 400);

  const accountType = body.account_type ?? 'Bank';
  const balance = Math.round(body.balance ?? 0);

  const res = await c.env.DB.prepare(
    `UPDATE bank_accounts
     SET name = ?1, account_type = ?2, balance = ?3
     WHERE id = ?4 AND user_id = ?5`
  ).bind(body.name, accountType, balance, id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'account not found' }, 404);

  return c.json({ id, name: body.name, account_type: accountType, balance });
});

// DELETE /api/bank-accounts/:id
bankAccounts.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB.prepare(
    `DELETE FROM bank_accounts WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).run();

  if (res.meta.changes === 0) return c.json({ error: 'account not found' }, 404);

  return c.json({ ok: true });
});

export default bankAccounts;
