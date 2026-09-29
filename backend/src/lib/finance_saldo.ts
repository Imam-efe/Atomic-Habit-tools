/**
 * Saldo rekening sebagai turunan, bukan angka yang dipelihara tangan.
 *
 * `bank_accounts.balance` sampai sekarang adalah total berjalan yang
 * disesuaikan di dua belas tempat terpisah. Pola itu punya satu cacat yang
 * tidak bisa ditambal: begitu satu jalur tulis lupa menyesuaikannya, saldonya
 * melenceng selamanya dan tidak ada cara memeriksanya, karena tidak ada
 * sumber kebenaran lain untuk dibandingkan.
 *
 * Berkas ini memberi sumber itu:
 *
 *   saldo = saldo_awal + mutasi budget_entries + transfer masuk - transfer keluar
 *
 * Invarian itu diverifikasi terhadap kedua belas situs mutasi sebelum ditulis,
 * satu per satu. Hasilnya: SETIAP mutasi saldo berpasangan dengan baris
 * budget_entries bertanda sama. Pembayaran hutang pun termasuk — ia menulis
 * baris budget_entries sendiri lewat `arahUang` di routes/debts.ts.
 *
 * Transfer antar rekening adalah satu-satunya sumber mutasi di luar
 * budget_entries, dan itu disengaja: menaruhnya di budget_entries berarti
 * setiap kueri laporan harus ingat mengecualikannya, dan yang lupa tetap
 * mengembalikan angka — hanya angkanya salah (lihat migrasi 0042). Yang
 * dijaga berkas ini adalah tidak adanya angka yang DIPELIHARA TANGAN, bukan
 * jumlah tabel yang dijumlahkan.
 *
 * Baris template transaksi berulang ikut dihitung, dan itu benar: POST
 * /api/budget menyesuaikan saldo saat template dibuat, jadi baris template
 * adalah kejadian pertamanya yang sungguhan. Salinan yang lahir dari cron
 * punya `recurrence` NULL dan dihitung terpisah sebagai barisnya sendiri.
 */

import type { D1Database } from '@cloudflare/workers-types';

/** Tanda mutasi: pengeluaran mengurangi, selain itu menambah. */
const EKSPRESI_MUTASI = `SUM(CASE WHEN type = 'expense' THEN -amount_idr ELSE amount_idr END)`;

/**
 * Transfer bersih satu rekening: yang masuk dikurangi yang keluar.
 *
 * Ditulis sebagai satu subkueri berkorelasi terhadap `?1` (user) dan kolom
 * rekening yang sedang dihitung, supaya bisa dipakai apa adanya baik di kueri
 * baca maupun di rumus cadangan — kalau keduanya menyimpang, saldo akan
 * melompat tepat saat penyemaian berjalan.
 */
const EKSPRESI_TRANSFER = (kolomRekening: string) => `(
  COALESCE((SELECT SUM(jumlah_idr) FROM finance_transfer
             WHERE user_id = ?1 AND ke_rekening_id = ${kolomRekening}), 0)
  - COALESCE((SELECT SUM(jumlah_idr) FROM finance_transfer
               WHERE user_id = ?1 AND dari_rekening_id = ${kolomRekening}), 0)
)`;

export interface SaldoRekening {
  bankAccountId: string;
  nama: string;
  jenis: string;
  /** Titik awal; nol untuk rekening yang belum disemai. */
  saldoAwal: number;
  /** Jumlah seluruh mutasi budget_entries pada rekening ini. */
  mutasi: number;
  /** Transfer masuk dikurangi transfer keluar. */
  transfer: number;
  /** saldoAwal + mutasi + transfer — angka yang seharusnya benar. */
  saldo: number;
  /** Isi kolom bank_accounts.balance apa adanya. */
  saldoTersimpan: number;
  /**
   * saldoTersimpan - saldo. Nol berarti kolom lama dan hitungan sepakat.
   *
   * Sesudah penyemaian angka ini nol menurut definisinya. Kalau kelak ia
   * bergerak dari nol, itu bukti ada jalur tulis yang menyesuaikan kolom
   * lama tanpa menulis baris budget_entries — persis kelas cacat yang
   * berkas ini dibuat untuk membuatnya terlihat.
   */
  selisih: number;
}

/**
 * Semai saldo pembuka untuk rekening yang belum punya.
 *
 * Nilainya diturunkan mundur dari keadaan sekarang — saldo tersimpan dikurangi
 * seluruh mutasi yang sudah ada — supaya saldo hasil hitungan PERSIS SAMA
 * dengan angka yang selama ini dilihat pengguna. Tidak ada angka yang berubah
 * di layar saat penyemaian, dan karena itu tidak ada yang perlu direkonsiliasi
 * secara manual.
 *
 * Idempoten dan aman dari balapan: kunci utamanya bank_account_id, jadi
 * penyemaian kedua untuk rekening yang sama diabaikan diam-diam alih-alih
 * menimpa titik awal yang sudah dipakai.
 */
export async function semaiSaldoAwal(db: D1Database, userId: string): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO finance_saldo_awal (bank_account_id, user_id, saldo_awal_idr)
     SELECT b.id, b.user_id,
            b.balance - COALESCE((
              SELECT ${EKSPRESI_MUTASI} FROM budget_entries e
               WHERE e.bank_account_id = b.id AND e.user_id = b.user_id
            ), 0) - ${EKSPRESI_TRANSFER('b.id')}
       FROM bank_accounts b
      WHERE b.user_id = ?1`
  ).bind(userId).run();
}

interface BarisSaldo {
  id: string;
  name: string;
  account_type: string;
  balance: number;
  saldo_awal: number;
  mutasi: number;
  transfer: number;
}

/**
 * Saldo seluruh rekening satu pengguna, terurut saldo terbesar dulu.
 *
 * Murni baca, tanpa efek samping — beberapa pemanggilnya (lib/daily.ts)
 * menyatakan kontrak itu di kepalanya sendiri, dan pembacaan yang diam-diam
 * menulis akan mengingkarinya.
 *
 * Rekening yang belum punya baris saldo pembuka tetap terbaca benar: titik
 * awalnya dihitung sebagai cadangan di SQL, dengan rumus yang sama persis
 * dengan yang dipakai penyemaian. Akibatnya rekening yang belum tersemai
 * berperilaku seperti sistem lama — saldonya sama dengan kolom `balance` —
 * alih-alih tampil nol dan membuat pengguna mengira uangnya hilang.
 *
 * Mutasi dijumlahkan sekali lewat satu agregat yang di-join, bukan satu
 * subkueri per rekening: rekening bertambah seiring waktu, dan kueri yang
 * biayanya tumbuh mengikuti jumlah rekening akan pelan justru pada pengguna
 * yang paling banyak memakainya.
 */
export async function saldoSemuaRekening(
  db: D1Database,
  userId: string
): Promise<SaldoRekening[]> {
  const rows = await db.prepare(
    `SELECT b.id, b.name, b.account_type, b.balance,
            COALESCE(
              s.saldo_awal_idr,
              b.balance - COALESCE(m.mutasi, 0) - ${EKSPRESI_TRANSFER('b.id')}
            ) AS saldo_awal,
            COALESCE(m.mutasi, 0) AS mutasi,
            ${EKSPRESI_TRANSFER('b.id')} AS transfer
       FROM bank_accounts b
       LEFT JOIN finance_saldo_awal s
              ON s.bank_account_id = b.id AND s.user_id = b.user_id
       LEFT JOIN (
            SELECT bank_account_id, ${EKSPRESI_MUTASI} AS mutasi
              FROM budget_entries
             WHERE user_id = ?1 AND bank_account_id IS NOT NULL
             GROUP BY bank_account_id
       ) m ON m.bank_account_id = b.id
      WHERE b.user_id = ?1`
  ).bind(userId).all<BarisSaldo>();

  return (rows.results ?? [])
    .map((r) => {
      const saldo = r.saldo_awal + r.mutasi + r.transfer;
      return {
        bankAccountId: r.id,
        nama: r.name,
        jenis: r.account_type,
        saldoAwal: r.saldo_awal,
        mutasi: r.mutasi,
        transfer: r.transfer,
        saldo,
        saldoTersimpan: r.balance,
        selisih: r.balance - saldo,
      };
    })
    .sort((a, b) => b.saldo - a.saldo);
}

/** Total seluruh rekening — dipakai kekayaan bersih, zakat, dan sisa aman harian. */
export function totalSaldo(daftar: ReadonlyArray<SaldoRekening>): number {
  return daftar.reduce((n, r) => n + r.saldo, 0);
}

/** Jumlah saldo seluruh rekening satu pengguna. */
export async function totalSaldoPengguna(db: D1Database, userId: string): Promise<number> {
  return totalSaldo(await saldoSemuaRekening(db, userId));
}
