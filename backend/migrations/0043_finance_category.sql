-- Kategori keuangan berid, dengan subkategori.
--
-- Sampai sekarang kategori hanyalah teks bebas di dalam `budget_entries.category`
-- dan `budget_limits.category`. Akibatnya tiga hal yang tidak kelihatan seperti
-- bug tapi merusak laporan:
--
-- 1. Mengganti nama kategori memutus riwayatnya. Teks lama tetap tertinggal di
--    baris lama, jadi "Hiburan & Rekreasi" yang diubah jadi "Hiburan" pecah
--    menjadi dua kategori yang tidak pernah bisa disatukan lagi.
-- 2. Salah ketik melahirkan kategori baru dalam diam. Satu huruf beda sudah
--    cukup untuk membuat pengeluaran hilang dari kolomnya.
-- 3. Tidak ada tempat untuk induk/anak, emoji, maupun urutan tampil.
--
-- Kaitannya tidak ditaruh sebagai kolom baru di `budget_entries`: `ALTER`
-- dilarang di berkas yang terdaftar (lihat README di direktori ini), dan
-- menambahkan kolom berarti tujuh penulis yang ada sekarang harus ikut
-- diubah serempak. Yang dipakai adalah tabel alias: teks apa adanya tetap
-- tersimpan di baris transaksi, dan teks itulah yang dipetakan ke id.
--
-- Kenapa alias, bukan satu baris kait per transaksi:
--   * nol baris tambahan untuk data yang sudah ada;
--   * mengganti nama kategori otomatis membawa seluruh riwayatnya, karena
--     alias menyimpan teks historis sementara `nama` menyimpan yang berlaku;
--   * dua teks yang sebetulnya sama (termasuk salah ketik) bisa diarahkan ke
--     satu id tanpa menyentuh satu pun baris transaksi.
--
-- Kategori bawaan TIDAK disemai di sini. Ia disemai per pengguna saat pertama
-- dipakai oleh lib/finance_kategori.ts, supaya tidak ada baris global yang
-- dimiliki bersama. Berkas ini hanya membangun tabelnya dan memetakan teks
-- yang sudah ada — tanpa menghapus atau mengubah apa pun di tabel lama.

CREATE TABLE IF NOT EXISTS finance_category (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  -- Subkategori menunjuk induknya. ON DELETE SET NULL, bukan CASCADE: induk
  -- yang dihapus tidak boleh ikut menghapus anaknya, karena anaknya masih
  -- dipakai oleh transaksi lama.
  induk_id TEXT REFERENCES finance_category(id) ON DELETE SET NULL,
  jenis TEXT NOT NULL,
  emoji TEXT,
  urutan INTEGER NOT NULL DEFAULT 0,
  -- 1 bila berasal dari daftar bawaan. Dipakai penyemaian untuk tahu mana
  -- yang sudah pernah dilengkapi emoji/urutan, bukan untuk melarang hapus.
  bawaan INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Nama unik per jenis, bukan per pengguna saja: 'Lainnya' sah ada dua kali,
-- sekali sebagai pemasukan dan sekali sebagai pengeluaran.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_category_nama
  ON finance_category(user_id, jenis, nama);
CREATE INDEX IF NOT EXISTS idx_finance_category_urut
  ON finance_category(user_id, jenis, urutan);
CREATE INDEX IF NOT EXISTS idx_finance_category_induk
  ON finance_category(induk_id);

-- Teks kategori (termasuk yang salah ketik dan yang sudah ditinggalkan) yang
-- menunjuk ke satu id. Kunci utamanya teksnya sendiri, jadi satu teks tidak
-- mungkin menunjuk dua kategori sekaligus.
CREATE TABLE IF NOT EXISTS finance_category_alias (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jenis TEXT NOT NULL,
  teks TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES finance_category(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, jenis, teks)
);
CREATE INDEX IF NOT EXISTS idx_finance_category_alias_cat
  ON finance_category_alias(category_id);

-- Pemetaan teks yang sudah ada.
--
-- Teks apa pun yang belum punya alias mendapat kategorinya sendiri, apa adanya
-- — termasuk salah ketik. Menggabungkannya otomatis dengan kategori bawaan
-- yang "mirip" akan memindahkan uang ke kolom yang belum tentu benar, dan
-- perbaikan semacam itu harus jadi keputusan pengguna, bukan tebakan migrasi.
--
-- Penjaganya adalah tabel alias, bukan nama kategori. Itu yang membuat berkas
-- ini aman diulang setiap deploy: kategori bawaan yang sudah diganti nama oleh
-- pengguna tidak akan lahir kembali di bawah nama lamanya, karena aliasnya
-- tetap ada.
INSERT OR IGNORE INTO finance_category (id, user_id, nama, jenis, urutan, bawaan)
SELECT 'fc_' || t.user_id || '_' || t.jenis || '_' || lower(hex(t.nama)),
       t.user_id, t.nama, t.jenis, 900, 0
  FROM (
    SELECT DISTINCT user_id, type AS jenis, category AS nama
      FROM budget_entries
     WHERE category IS NOT NULL AND trim(category) <> ''
       AND type IN ('income', 'expense')
    UNION
    SELECT DISTINCT user_id, 'expense' AS jenis, category AS nama
      FROM budget_limits
     WHERE category IS NOT NULL AND trim(category) <> ''
  ) t
 WHERE NOT EXISTS (
   SELECT 1 FROM finance_category_alias a
    WHERE a.user_id = t.user_id AND a.jenis = t.jenis AND a.teks = t.nama
 );

-- Idnya dicari lewat nama, bukan dirumuskan ulang: kalau kategori dengan nama
-- itu sudah ada lebih dulu (dibuat pengguna, dengan id acak), pernyataan di
-- atas tidak menyisipkan apa-apa dan alias harus menunjuk baris yang memang
-- ada — bukan id turunan yang tidak pernah lahir.
INSERT OR IGNORE INTO finance_category_alias (user_id, jenis, teks, category_id)
SELECT t.user_id, t.jenis, t.nama, c.id
  FROM (
    SELECT DISTINCT user_id, type AS jenis, category AS nama
      FROM budget_entries
     WHERE category IS NOT NULL AND trim(category) <> ''
       AND type IN ('income', 'expense')
    UNION
    SELECT DISTINCT user_id, 'expense' AS jenis, category AS nama
      FROM budget_limits
     WHERE category IS NOT NULL AND trim(category) <> ''
  ) t
  JOIN finance_category c
    ON c.user_id = t.user_id AND c.jenis = t.jenis AND c.nama = t.nama;
