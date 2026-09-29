-- Tagihan terjadwal, dan riwayat pembayarannya per periode.
--
-- Aplikasi ini sudah punya transaksi berulang (`budget_entries.recurrence`,
-- lihat migrasi 0008), tapi itu barang yang berbeda: ia MEMBUAT transaksinya
-- sendiri saat jatuh tempo dan langsung menggeser saldo rekening. Itu autodebet
-- — benar untuk hal yang memang keluar sendiri dari rekening, dan salah untuk
-- tagihan yang dibayar dengan tangan.
--
-- Bedanya bukan soal kenyamanan, tapi soal saldo yang jujur: tagihan listrik
-- yang dicatat lunas padahal belum dibayar membuat saldo turunan (lihat
-- lib/finance_saldo.ts) melaporkan uang yang masih ada di rekening sebagai
-- sudah pergi. Tagihan di tabel ini karena itu TIDAK memposting apa pun
-- sendiri; ia cuma terlihat datang, dan barisnya di `budget_entries` baru lahir
-- ketika pengguna menyatakan sudah membayar.
--
-- Keduanya sengaja dibiarkan hidup berdampingan. Yang benar-benar autodebet
-- tetap dipakai lewat `recurrence`; yang dibayar manual lewat tabel ini.
--
-- Kosakata `ulang` disamakan dengan `budget_entries.recurrence`
-- ('daily'|'weekly'|'monthly') supaya `advanceDate` di lib/validate.ts bisa
-- dipakai apa adanya — bukan kosakata paralel yang harus diterjemahkan.

CREATE TABLE IF NOT EXISTS finance_tagihan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  jumlah_idr INTEGER NOT NULL,
  -- Kemunculan berikutnya yang BELUM dibayar. Maju setiap kali dibayar, jadi
  -- nilai yang sudah lewat berarti benar-benar telat — bukan sisa data lama.
  jatuh_tempo TEXT NOT NULL,
  -- NULL berarti sekali saja.
  ulang TEXT,
  -- Tanggal asal dalam bulan (1-31), disimpan terpisah dari `jatuh_tempo`.
  --
  -- Tanpa ini, tagihan tanggal 31 hanyut permanen: Januari 31 dijepit jadi
  -- Februari 28, lalu bulan-bulan berikutnya dihitung dari 28 dan tagihannya
  -- selamanya pindah ke tanggal 28. Yang benar adalah kembali ke 31 begitu
  -- bulannya cukup panjang, dan itu hanya mungkin kalau angka asalnya masih
  -- tersimpan. Diisi dari hari `jatuh_tempo` saat tagihan dibuat.
  hari_anchor INTEGER,
  -- Tagihan masuk ikut ditampung: proyeksi yang hanya menghitung uang keluar
  -- selalu terlihat lebih buruk daripada kenyataan, dan proyeksi yang selalu
  -- menakut-nakuti akan diabaikan. Gaji yang datang tanggal 25 itu bagian dari
  -- gambaran yang sama.
  jenis TEXT NOT NULL DEFAULT 'expense',
  kategori TEXT NOT NULL,
  bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  aktif INTEGER NOT NULL DEFAULT 1,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_finance_tagihan_user
  ON finance_tagihan(user_id, aktif, jatuh_tempo);

CREATE TABLE IF NOT EXISTS finance_tagihan_bayar (
  id TEXT PRIMARY KEY,
  tagihan_id TEXT NOT NULL REFERENCES finance_tagihan(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kemunculan mana yang dibayar, bukan kapan dibayarnya. Tagihan Februari
  -- yang dibayar bulan Maret tetap tercatat sebagai periode Februari.
  periode TEXT NOT NULL,
  jumlah_idr INTEGER NOT NULL,
  dibayar_pada TEXT NOT NULL,
  -- Baris budget_entries yang lahir dari pembayaran ini, supaya pembatalan
  -- bisa menariknya kembali. NULL bila tagihan tidak tertaut rekening.
  budget_entry_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Penjaga terpenting di berkas ini: satu periode hanya bisa dibayar sekali.
-- Tanpa ini, satu ketukan ganda di ponsel — jaringan lambat, tombol ditekan
-- dua kali — akan mencatat tagihan yang sama dua kali dan menggeser saldo dua
-- kali, tanpa galat apa pun yang muncul.
CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_tagihan_bayar_periode
  ON finance_tagihan_bayar(tagihan_id, periode);

CREATE INDEX IF NOT EXISTS idx_finance_tagihan_bayar_user
  ON finance_tagihan_bayar(user_id, dibayar_pada);
