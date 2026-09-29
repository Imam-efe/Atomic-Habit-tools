/**
 * Transfer antar rekening.
 *
 * Memindahkan uang bukan pemasukan dan bukan pengeluaran. Sebelum rute ini
 * ada, satu-satunya cara mencatatnya adalah sepasang transaksi biasa — dan
 * akibatnya setiap laporan pengeluaran membengkak oleh uang yang cuma
 * berpindah tempat. Tabel terpisah membuat laporan yang tidak tahu-menahu
 * soal transfer otomatis benar (lihat migrasi 0042).
 *
 * Saldo kedua rekening ikut benar dengan sendirinya: lib/finance_saldo.ts
 * menurunkannya dari transaksi dan transfer, jadi rute ini tidak perlu
 * menghitung saldo apa pun sendiri.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { nanoid } from '../lib/nanoid';
import { validate, isDate, jakartaToday } from '../lib/validate';

const transfer = new Hono<AuthContext>();
transfer.use('/*', requireAuth);

interface TransferRow {
  id: string;
  dari_rekening_id: string;
  ke_rekening_id: string;
  jumlah_idr: number;
  tanggal: string;
  catatan: string | null;
  dari_nama: string | null;
  ke_nama: string | null;
}

// GET /api/transfer?limit=50
transfer.get('/', async (c) => {
  const user = c.get('user');
  const limitMentah = Number(c.req.query('limit') ?? 50);
  const limit = Number.isFinite(limitMentah) ? Math.min(Math.max(Math.round(limitMentah), 1), 200) : 50;

  // Nama rekening ikut diambil supaya daftar bisa dibaca tanpa panggilan
  // kedua. LEFT JOIN, bukan JOIN: rekening yang terhapus tidak boleh
  // menghilangkan riwayat transfernya dari daftar tanpa penjelasan.
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.dari_rekening_id, t.ke_rekening_id, t.jumlah_idr, t.tanggal, t.catatan,
            d.name AS dari_nama, k.name AS ke_nama
       FROM finance_transfer t
       LEFT JOIN bank_accounts d ON d.id = t.dari_rekening_id AND d.user_id = t.user_id
       LEFT JOIN bank_accounts k ON k.id = t.ke_rekening_id AND k.user_id = t.user_id
      WHERE t.user_id = ?1
      ORDER BY t.tanggal DESC, t.created_at DESC
      LIMIT ?2`
  ).bind(user.sub, limit).all<TransferRow>();

  return c.json({
    transfer: (rows.results ?? []).map((r) => ({
      id: r.id,
      dariRekeningId: r.dari_rekening_id,
      keRekeningId: r.ke_rekening_id,
      dariNama: r.dari_nama,
      keNama: r.ke_nama,
      jumlah: r.jumlah_idr,
      tanggal: r.tanggal,
      catatan: r.catatan,
    })),
  });
});

// POST /api/transfer
transfer.post('/', async (c) => {
  const user = c.get('user');
  type Body = {
    dari_rekening_id?: string;
    ke_rekening_id?: string;
    jumlah?: number;
    tanggal?: string;
    catatan?: string;
  };
  const body = await c.req.json<Body>().catch((): Body => ({}));

  const err = validate(body as Record<string, unknown>, {
    dari_rekening_id: { type: 'string' },
    ke_rekening_id: { type: 'string' },
    jumlah: { type: 'number', min: 1 },
  });
  if (err) return c.json({ error: err }, 400);

  const dari = body.dari_rekening_id!;
  const ke = body.ke_rekening_id!;

  // Transfer ke rekening yang sama tidak memindahkan apa pun, tapi tetap
  // melahirkan baris yang membuat riwayat sulit dibaca. Ditolak, bukan
  // diabaikan diam-diam.
  if (dari === ke) {
    return c.json({ error: 'rekening asal dan tujuan tidak boleh sama' }, 400);
  }

  const jumlah = Math.round(body.jumlah!);
  const tanggal = typeof body.tanggal === 'string' && isDate(body.tanggal)
    ? body.tanggal
    : jakartaToday();

  // Kedua rekening diperiksa dalam satu kueri, dan kepemilikannya ikut
  // disaring di sini — bukan sesudahnya. Rekening milik orang lain harus
  // terlihat sama persis dengan rekening yang tidak ada.
  const punya = await c.env.DB.prepare(
    `SELECT id FROM bank_accounts WHERE user_id = ?1 AND id IN (?2, ?3)`
  ).bind(user.sub, dari, ke).all<{ id: string }>();
  const ditemukan = new Set((punya.results ?? []).map((r) => r.id));

  if (!ditemukan.has(dari) || !ditemukan.has(ke)) {
    return c.json({ error: 'rekening tidak ditemukan' }, 404);
  }

  const id = nanoid();

  // Kolom bank_accounts.balance ikut digeser meski tidak ada lagi yang
  // membacanya untuk kebenaran: ia berfungsi sebagai checksum terhadap saldo
  // turunan (lihat routes/bank_accounts.ts). Transfer yang melewatkannya akan
  // membuat checksum menyala untuk transaksi yang sebetulnya benar.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO finance_transfer
         (id, user_id, dari_rekening_id, ke_rekening_id, jumlah_idr, tanggal, catatan)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(id, user.sub, dari, ke, jumlah, tanggal, body.catatan?.trim() || null),
    c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(jumlah, dari, user.sub),
    c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(jumlah, ke, user.sub),
  ]);

  return c.json({ id, dariRekeningId: dari, keRekeningId: ke, jumlah, tanggal }, 201);
});

// DELETE /api/transfer/:id
transfer.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const baris = await c.env.DB.prepare(
    `SELECT dari_rekening_id, ke_rekening_id, jumlah_idr FROM finance_transfer
      WHERE id = ?1 AND user_id = ?2`
  ).bind(id, user.sub).first<{ dari_rekening_id: string; ke_rekening_id: string; jumlah_idr: number }>();

  // 404, bukan 403: transfer milik orang lain terlihat sama dengan yang tidak ada.
  if (!baris) return c.json({ error: 'transfer tidak ditemukan' }, 404);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM finance_transfer WHERE id = ?1 AND user_id = ?2')
      .bind(id, user.sub),
    // Kebalikan dari saat dibuat, supaya checksum tetap nol.
    c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance + ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(baris.jumlah_idr, baris.dari_rekening_id, user.sub),
    c.env.DB.prepare(
      `UPDATE bank_accounts SET balance = balance - ?1 WHERE id = ?2 AND user_id = ?3`
    ).bind(baris.jumlah_idr, baris.ke_rekening_id, user.sub),
  ]);

  return c.json({ ok: true });
});

export default transfer;
