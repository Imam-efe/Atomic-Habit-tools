/**
 * Uji kategori berid.
 *
 * Yang dijaga di sini semuanya jenis kesalahan yang tidak memunculkan galat —
 * hanya kategori yang pecah atau uang yang pindah kolom tanpa ada yang tahu:
 *
 * 1. Penyemaian ulang tidak boleh menggandakan apa pun, dan tidak boleh
 *    menghidupkan kembali kategori yang sudah diganti nama oleh pengguna.
 * 2. Mengganti nama kategori harus membawa seluruh riwayat teks lamanya.
 * 3. Teks lama yang salah ketik harus tetap ada sebagai kategorinya sendiri,
 *    bukan digabung menebak ke kategori bawaan yang "mirip".
 * 4. Rumus id di TypeScript dan di migrasi 0043 harus identik. Kalau menyimpang
 *    satu byte saja, penyemaian akan melahirkan kembaran dari setiap kategori
 *    hasil backfill.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, seedUser, type FakeD1 } from '../test/d1';
import {
  KATEGORI_BAWAAN,
  JENIS_KATEGORI,
  idKategori,
  semaiKategori,
  daftarKategori,
  pastikanKategori,
  petaAlias,
  kunciAlias,
} from './finance_kategori';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../routes/budget';

let db: FakeD1;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, 'user-1');
  seedUser(db, 'user-2');
});

afterEach(() => db.__close());

const D = () => db as never;

async function catat(
  userId: string,
  type: 'income' | 'expense',
  category: string,
  id = `e-${Math.random().toString(36).slice(2)}`
) {
  await db.prepare(
    `INSERT INTO budget_entries (id, user_id, type, amount_idr, category, entry_date, created_at)
     VALUES (?1, ?2, ?3, 10000, ?4, '2026-09-01', 0)`
  ).bind(id, userId, type, category).run();
}

/** Menjalankan ulang bagian backfill migrasi 0043, seperti saat deploy. */
async function jalankanBackfill() {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const sql = readFileSync(
    join(import.meta.dirname, '../../migrations/0043_finance_category.sql'),
    'utf8'
  );
  // FakeD1 tidak mengekspos exec; pernyataannya dipisah di titik koma akhir
  // baris, sama seperti yang dilakukan wrangler pada berkas migrasi.
  for (const bagian of sql.split(/;\s*\n/)) {
    const bersih = bagian.replace(/^\s*--.*$/gm, '').trim();
    if (bersih) await db.prepare(bersih).run();
  }
}

describe('idKategori', () => {
  it('sama persis dengan rumus di migrasi 0043', async () => {
    // Ini penjaga terpenting di berkas ini. Migrasi membuat baris untuk teks
    // lama dengan 'fc_' || user || '_' || jenis || '_' || lower(hex(nama));
    // penyemaian harus mengenali baris yang sama, bukan membuat kembarannya.
    for (const nama of ['Makanan & Minuman', 'Lainnya', 'Ojek & Taksi Online', "Tanda ' kutip"]) {
      const dariSqlite = await db.prepare(
        `SELECT 'fc_' || ?1 || '_' || ?2 || '_' || lower(hex(?3)) AS id`
      ).bind('user-1', 'expense', nama).first<{ id: string }>();
      expect(idKategori('user-1', 'expense', nama)).toBe(dariSqlite!.id);
    }
  });

  it('memisahkan jenis, supaya Lainnya pemasukan dan pengeluaran tidak satu baris', () => {
    expect(idKategori('user-1', 'income', 'Lainnya'))
      .not.toBe(idKategori('user-1', 'expense', 'Lainnya'));
  });
});

describe('KATEGORI_BAWAAN', () => {
  it('nama indukannya sama persis dengan daftar yang ditawarkan formulir', () => {
    // Kalau menyimpang, transaksi lama memetakan ke kategori hasil backfill
    // sementara formulirnya menawarkan kategori bawaan — dua kolom untuk hal
    // yang sama, dan tidak satu pun galat muncul.
    expect(KATEGORI_BAWAAN.expense.map((k) => k.nama)).toEqual(EXPENSE_CATEGORIES);
    expect(KATEGORI_BAWAAN.income.map((k) => k.nama)).toEqual(INCOME_CATEGORIES);
  });

  it('tidak ada nama kembar dalam satu jenis', () => {
    // Indeks unik (user_id, jenis, nama) akan menolaknya diam-diam lewat
    // INSERT OR IGNORE, jadi kembarannya hilang tanpa galat apa pun.
    for (const jenis of JENIS_KATEGORI) {
      const semua = KATEGORI_BAWAAN[jenis].flatMap((k) => [k.nama, ...(k.anak ?? []).map((a) => a.nama)]);
      expect(new Set(semua).size).toBe(semua.length);
    }
  });
});

describe('semaiKategori', () => {
  it('menyemai induk beserta anaknya dan menautkannya', async () => {
    await semaiKategori(D(), 'user-1');

    const semua = await daftarKategori(D(), 'user-1');
    const jumlahBawaan = JENIS_KATEGORI.reduce(
      (n, j) => n + KATEGORI_BAWAAN[j].reduce((m, k) => m + 1 + (k.anak?.length ?? 0), 0),
      0
    );
    expect(semua).toHaveLength(jumlahBawaan);

    const induk = semua.find((k) => k.nama === 'Tagihan & Utilitas')!;
    const anak = semua.find((k) => k.nama === 'Listrik')!;
    expect(induk.indukId).toBeNull();
    expect(anak.indukId).toBe(induk.id);
    expect(anak.jenis).toBe('expense');
    expect(induk.emoji).toBe('🧾');
    expect(induk.bawaan).toBe(true);
  });

  it('anak selalu berada tepat setelah induknya dalam urutan tampil', async () => {
    await semaiKategori(D(), 'user-1');
    const pengeluaran = await daftarKategori(D(), 'user-1', 'expense');

    const posisiInduk = pengeluaran.findIndex((k) => k.nama === 'Kesehatan & Obat');
    const indukId = pengeluaran[posisiInduk].id;
    const anaknya = KATEGORI_BAWAAN.expense.find((k) => k.nama === 'Kesehatan & Obat')!.anak!;

    for (let i = 0; i < anaknya.length; i++) {
      expect(pengeluaran[posisiInduk + 1 + i].nama).toBe(anaknya[i].nama);
      expect(pengeluaran[posisiInduk + 1 + i].indukId).toBe(indukId);
    }
  });

  it('dipanggil dua kali tidak menggandakan apa pun', async () => {
    await semaiKategori(D(), 'user-1');
    const pertama = await daftarKategori(D(), 'user-1');
    await semaiKategori(D(), 'user-1');
    await semaiKategori(D(), 'user-1');
    expect(await daftarKategori(D(), 'user-1')).toEqual(pertama);
  });

  it('tidak menghidupkan kembali kategori yang sudah diganti nama pengguna', async () => {
    await semaiKategori(D(), 'user-1');
    await db.prepare(
      `UPDATE finance_category SET nama = 'Makan' WHERE user_id = ?1 AND jenis = 'expense' AND nama = 'Makanan & Minuman'`
    ).bind('user-1').run();

    await semaiKategori(D(), 'user-1');

    const nama = (await daftarKategori(D(), 'user-1', 'expense')).map((k) => k.nama);
    expect(nama).toContain('Makan');
    expect(nama).not.toContain('Makanan & Minuman');
  });

  it('tidak menghidupkan kembali kategori bawaan berid acak yang diganti nama', async () => {
    // Varian dari uji di atas, dan varian inilah yang benar-benar menguji
    // penjaganya. Kategori berid turunan terlindungi dua kali: aliasnya ada,
    // DAN idnya bentrok di kunci utama kalau dicoba disisipkan lagi. Kategori
    // berid acak — dibuat pengguna, atau lahir dari backfill teks lama yang
    // barisnya sudah ada lebih dulu — hanya punya aliasnya.
    await db.prepare(
      `INSERT INTO finance_category (id, user_id, nama, jenis, urutan, bawaan)
       VALUES ('acak-mm', ?1, 'Makanan & Minuman', 'expense', 0, 0)`
    ).bind('user-1').run();
    await semaiKategori(D(), 'user-1');

    const mm = (await daftarKategori(D(), 'user-1', 'expense'))
      .filter((k) => k.nama === 'Makanan & Minuman');
    expect(mm).toHaveLength(1);
    expect(mm[0].id).toBe('acak-mm');

    await db.prepare('UPDATE finance_category SET nama = ?2 WHERE id = ?1')
      .bind('acak-mm', 'Makan').run();
    await semaiKategori(D(), 'user-1');

    const nama = (await daftarKategori(D(), 'user-1', 'expense')).map((k) => k.nama);
    expect(nama).toContain('Makan');
    expect(nama).not.toContain('Makanan & Minuman');
  });

  it('tidak menghidupkan kembali kategori yang sudah dihapus pengguna', async () => {
    await semaiKategori(D(), 'user-1');
    const belanja = (await daftarKategori(D(), 'user-1', 'expense'))
      .find((k) => k.nama === 'Belanja Bulanan')!;
    // Aliasnya ikut terhapus lewat ON DELETE CASCADE, jadi penjaganya hilang.
    // Yang benar tetap: kategori itu tidak boleh kembali sendiri.
    await db.prepare('DELETE FROM finance_category WHERE id = ?1').bind(belanja.id).run();
    await db.prepare(
      `INSERT OR IGNORE INTO finance_category_alias (user_id, jenis, teks, category_id)
       SELECT ?1, 'expense', 'Belanja Bulanan', c.id FROM finance_category c
        WHERE c.user_id = ?1 AND c.jenis = 'expense' AND c.nama = 'Lainnya'`
    ).bind('user-1').run();

    await semaiKategori(D(), 'user-1');
    const nama = (await daftarKategori(D(), 'user-1', 'expense')).map((k) => k.nama);
    expect(nama).not.toContain('Belanja Bulanan');
  });

  it('tidak menyentuh kategori pengguna lain', async () => {
    await semaiKategori(D(), 'user-1');
    expect(await daftarKategori(D(), 'user-2')).toEqual([]);
  });

  it('melengkapi kategori hasil backfill di tempat, bukan menggandakannya', async () => {
    // Urutan seperti di produksi: teks lama sudah ada, migrasi membuatkan
    // barisnya tanpa emoji, lalu penyemaian berjalan.
    await catat('user-1', 'expense', 'Makanan & Minuman');
    await jalankanBackfill();

    const sebelum = (await daftarKategori(D(), 'user-1', 'expense'))
      .find((k) => k.nama === 'Makanan & Minuman')!;
    expect(sebelum.emoji).toBeNull();
    expect(sebelum.bawaan).toBe(false);

    await semaiKategori(D(), 'user-1');

    const sesudah = (await daftarKategori(D(), 'user-1', 'expense'))
      .filter((k) => k.nama === 'Makanan & Minuman');
    expect(sesudah).toHaveLength(1);
    expect(sesudah[0].id).toBe(sebelum.id);
    expect(sesudah[0].emoji).toBe('🍚');
    expect(sesudah[0].bawaan).toBe(true);
  });
});

describe('backfill migrasi 0043', () => {
  it('memberi setiap teks lama kategorinya sendiri, termasuk yang salah ketik', async () => {
    await catat('user-1', 'expense', 'Makanan & Minuman');
    await catat('user-1', 'expense', 'Makanan & Minumann');
    await jalankanBackfill();

    const nama = (await daftarKategori(D(), 'user-1', 'expense')).map((k) => k.nama);
    // Salah ketiknya TIDAK digabung otomatis: menebak berarti memindahkan uang
    // ke kolom yang belum tentu benar tanpa pengguna pernah tahu.
    expect(nama).toContain('Makanan & Minuman');
    expect(nama).toContain('Makanan & Minumann');
  });

  it('memisahkan teks yang sama pada jenis yang berbeda', async () => {
    await catat('user-1', 'expense', 'Lainnya');
    await catat('user-1', 'income', 'Lainnya');
    await jalankanBackfill();

    const peta = await petaAlias(D(), 'user-1');
    expect(peta.get(kunciAlias('expense', 'Lainnya')))
      .not.toBe(peta.get(kunciAlias('income', 'Lainnya')));
  });

  it('melewati teks kosong', async () => {
    await catat('user-1', 'expense', '   ');
    await jalankanBackfill();
    expect(await daftarKategori(D(), 'user-1')).toEqual([]);
  });

  it('tidak mencampur teks antar pengguna', async () => {
    await catat('user-1', 'expense', 'Kopi');
    await catat('user-2', 'expense', 'Rokok');
    await jalankanBackfill();

    expect((await daftarKategori(D(), 'user-1')).map((k) => k.nama)).toEqual(['Kopi']);
    expect((await daftarKategori(D(), 'user-2')).map((k) => k.nama)).toEqual(['Rokok']);
  });

  it('ikut memetakan kategori pada limit budget', async () => {
    await db.prepare(
      `INSERT INTO budget_limits (id, user_id, category, monthly_limit_idr, month)
       VALUES ('l1', ?1, 'Tagihan & Utilitas', 300000, '2026-09')`
    ).bind('user-1').run();
    await jalankanBackfill();

    const peta = await petaAlias(D(), 'user-1');
    expect(peta.get(kunciAlias('expense', 'Tagihan & Utilitas'))).toBeTruthy();
  });

  it('setiap alias menunjuk kategori yang benar-benar ada', async () => {
    await catat('user-1', 'expense', 'Kopi');
    await catat('user-1', 'income', 'Gaji');
    await jalankanBackfill();

    const yatim = await db.prepare(
      `SELECT COUNT(*) AS n FROM finance_category_alias a
        WHERE NOT EXISTS (SELECT 1 FROM finance_category c WHERE c.id = a.category_id)`
    ).first<{ n: number }>();
    expect(yatim!.n).toBe(0);
  });
});

describe('pastikanKategori', () => {
  it('mengembalikan id yang sama untuk teks yang sudah dikenal', async () => {
    await semaiKategori(D(), 'user-1');
    const a = await pastikanKategori(D(), 'user-1', 'expense', 'Bensin');
    const b = await pastikanKategori(D(), 'user-1', 'expense', 'Bensin');
    expect(a).toBe(b);

    const bensin = (await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.nama === 'Bensin')!;
    expect(a).toBe(bensin.id);
  });

  it('membuatkan kategori sendiri untuk teks yang belum dikenal, bukan melempar ke Lainnya', async () => {
    await semaiKategori(D(), 'user-1');
    const lainnya = (await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.nama === 'Lainnya')!;

    const id = await pastikanKategori(D(), 'user-1', 'expense', 'Iuran RT');
    expect(id).not.toBe(lainnya.id);

    const baru = (await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.nama === 'Iuran RT')!;
    expect(baru.id).toBe(id);
    expect(baru.bawaan).toBe(false);
  });

  it('tidak menggandakan kategori yang namanya sudah ada tanpa alias', async () => {
    await db.prepare(
      `INSERT INTO finance_category (id, user_id, nama, jenis, urutan, bawaan)
       VALUES ('acak123', ?1, 'Kopi', 'expense', 0, 0)`
    ).bind('user-1').run();

    const id = await pastikanKategori(D(), 'user-1', 'expense', 'Kopi');
    expect(id).toBe('acak123');
    expect((await daftarKategori(D(), 'user-1', 'expense')).filter((k) => k.nama === 'Kopi'))
      .toHaveLength(1);
  });

  it('menganggap spasi di ujung sebagai teks yang sama', async () => {
    await semaiKategori(D(), 'user-1');
    const a = await pastikanKategori(D(), 'user-1', 'expense', 'Bensin');
    const b = await pastikanKategori(D(), 'user-1', 'expense', '  Bensin  ');
    expect(b).toBe(a);
  });

  it('teks kosong tidak melahirkan kategori tanpa nama', async () => {
    expect(await pastikanKategori(D(), 'user-1', 'expense', '   ')).toBeNull();
    expect(await daftarKategori(D(), 'user-1')).toEqual([]);
  });

  it('tidak bisa dipakai menyentuh kategori pengguna lain', async () => {
    await semaiKategori(D(), 'user-1');
    const id = await pastikanKategori(D(), 'user-2', 'expense', 'Bensin');

    const milikSatu = (await daftarKategori(D(), 'user-1', 'expense')).find((k) => k.nama === 'Bensin')!;
    expect(id).not.toBe(milikSatu.id);
  });
});

describe('ganti nama kategori', () => {
  it('membawa seluruh riwayat teks lamanya', async () => {
    // Inilah alasan seluruh berkas ini ada. Sebelum ada tabel alias, mengganti
    // nama kategori memecah riwayatnya jadi dua yang tak pernah bisa disatukan.
    await catat('user-1', 'expense', 'Hiburan & Rekreasi', 'lama-1');
    await jalankanBackfill();
    await semaiKategori(D(), 'user-1');

    const sebelum = (await daftarKategori(D(), 'user-1', 'expense'))
      .find((k) => k.nama === 'Hiburan & Rekreasi')!;

    await db.prepare('UPDATE finance_category SET nama = ?2 WHERE id = ?1')
      .bind(sebelum.id, 'Hiburan').run();

    // Teks lama di baris transaksi tidak ikut diubah — dan tidak perlu.
    const peta = await petaAlias(D(), 'user-1');
    expect(peta.get(kunciAlias('expense', 'Hiburan & Rekreasi'))).toBe(sebelum.id);

    // Transaksi baru menulis nama yang berlaku sekarang; keduanya satu id.
    const idBaru = await pastikanKategori(D(), 'user-1', 'expense', 'Hiburan');
    expect(idBaru).toBe(sebelum.id);
  });
});
