/**
 * Proyeksi saldo: saldo hari ini dijalankan ke depan melewati semua yang sudah
 * diketahui akan datang.
 *
 * Tiga sumber pergerakan, dan ketiganya harus ikut supaya proyeksinya jujur:
 *
 *   1. Tagihan terjadwal yang belum dibayar (finance_tagihan).
 *   2. Transaksi berulang yang memposting sendiri (budget_entries.recurrence).
 *      Ini yang paling mudah terlupakan — dan melupakannya membuat proyeksi
 *      memperkirakan saldo LEBIH BESAR daripada yang akan terjadi, arah yang
 *      paling berbahaya untuk salah.
 *   3. Utang dan piutang yang jatuh tempo (debts), dengan tanda berlawanan.
 *
 * Titik awalnya saldo turunan dari lib/finance_saldo.ts, bukan kolom
 * `bank_accounts.balance`. Kalau kolom itu pernah melenceng, proyeksinya akan
 * melenceng sejak angka pertama.
 *
 * Pengguna yang memasang tagihan DAN transaksi berulang untuk hal yang sama
 * akan terhitung dua kali. Itu tidak bisa dideteksi dari data — keduanya baris
 * yang sah — jadi rincian per baris ikut dikembalikan supaya penyebabnya
 * terlihat, bukan cuma angka akhir yang membingungkan.
 */

import { Hono } from 'hono';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { jakartaToday } from '../lib/validate';
import { totalSaldoPengguna } from '../lib/finance_saldo';
import { shiftDate } from '../lib/daily';
import {
  proyeksikanSaldo,
  barisDariTagihan,
  barisDariBerulang,
  barisDariHutang,
  type BarisProyeksi,
} from '../lib/finance_tagihan';

const proyeksi = new Hono<AuthContext>();
proyeksi.use('/*', requireAuth);

// GET /api/proyeksi?days=30
proyeksi.get('/', async (c) => {
  const user = c.get('user');
  const today = jakartaToday();

  const hariMentah = Number(c.req.query('days') ?? 30);
  // Dijepit: horizon 10 tahun pada tagihan harian menghasilkan ribuan baris
  // dalam satu permintaan.
  const hari = Number.isFinite(hariMentah)
    ? Math.min(Math.max(Math.round(hariMentah), 1), 365)
    : 30;
  const hingga = shiftDate(today, hari);

  const [saldoAwal, tagihanRows, berulangRows, hutangRows] = await Promise.all([
    totalSaldoPengguna(c.env.DB, user.sub),

    c.env.DB.prepare(
      `SELECT id, nama, jumlah_idr, jatuh_tempo, ulang, hari_anchor, jenis
         FROM finance_tagihan
        WHERE user_id = ?1 AND aktif = 1 AND jatuh_tempo <= ?2`
    ).bind(user.sub, hingga).all<{
      id: string; nama: string; jumlah_idr: number; jatuh_tempo: string;
      ulang: string | null; hari_anchor: number | null; jenis: string;
    }>(),

    c.env.DB.prepare(
      `SELECT id, type, amount_idr, category, note, recurrence, next_recurrence_date
         FROM budget_entries
        WHERE user_id = ?1 AND recurrence IS NOT NULL
          AND next_recurrence_date IS NOT NULL AND next_recurrence_date <= ?2`
    ).bind(user.sub, hingga).all<{
      id: string; type: string; amount_idr: number; category: string;
      note: string | null; recurrence: string; next_recurrence_date: string;
    }>(),

    c.env.DB.prepare(
      `SELECT id, type, person_name, amount_idr, due_date
         FROM debts
        WHERE user_id = ?1 AND status != 'paid'
          AND due_date IS NOT NULL AND due_date <= ?2`
    ).bind(user.sub, hingga).all<{
      id: string; type: string; person_name: string; amount_idr: number; due_date: string;
    }>(),
  ]);

  const baris: BarisProyeksi[] = [
    ...(tagihanRows.results ?? []).flatMap((t) => barisDariTagihan(t, hingga)),
    ...(berulangRows.results ?? []).flatMap((b) => barisDariBerulang(b, hingga)),
    ...(hutangRows.results ?? []).flatMap((h) => barisDariHutang(h)),
  ];

  const hasil = proyeksikanSaldo(saldoAwal, baris, today, hingga);

  return c.json({
    mulai: today,
    hingga,
    hari,
    saldoAwal: hasil.saldoAwal,
    saldoAkhir: hasil.saldoAkhir,
    totalKeluar: hasil.totalKeluar,
    totalMasuk: hasil.totalMasuk,
    // Intinya ada di sini: saldo akhir yang positif masih bisa menyembunyikan
    // minus di tengah horizon, dan minus itulah yang jadi masalah.
    tanggalMinus: hasil.tanggalMinus,
    titik: hasil.titik,
    baris: hasil.baris,
  });
});

export default proyeksi;
