-- Transfer antar rekening.
--
-- Sebelum ini, memindahkan uang dari Bank ke Tunai harus dicatat sebagai
-- pengeluaran di satu sisi dan pemasukan di sisi lain. Saldonya benar, tapi
-- laporannya bohong: uang yang cuma berpindah tempat ikut terhitung sebagai
-- belanja bulan itu, dan tiap ringkasan pengeluaran jadi lebih besar dari
-- yang sebenarnya.
--
-- Tabel terpisah, BUKAN baris budget_entries bertipe 'transfer'. Alasannya
-- satu dan menentukan: setiap kueri laporan yang membaca budget_entries harus
-- ingat mengecualikan tipe itu, dan kueri yang lupa tetap jalan serta tetap
-- mengembalikan angka — hanya angkanya salah. Dengan tabel sendiri, laporan
-- yang tidak tahu-menahu soal transfer otomatis benar.
--
-- Konsekuensinya saldo kini diturunkan dari dua tabel, bukan satu (lihat
-- lib/finance_saldo.ts). Itu tetap saldo TURUNAN — yang dijaga adalah tidak
-- adanya angka yang dipelihara tangan, bukan jumlah tabel yang dijumlahkan.
CREATE TABLE IF NOT EXISTS finance_transfer (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kedua rekening ikut terhapus bersama rekeningnya: transfer yang salah
  -- satu ujungnya hilang bukan catatan yang bisa dibaca, dan menyisakannya
  -- membuat saldo rekening yang tersisa ikut salah.
  dari_rekening_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  ke_rekening_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  jumlah_idr INTEGER NOT NULL,
  tanggal TEXT NOT NULL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Dua indeks terpisah, satu per arah: saldo tiap rekening perlu menjumlahkan
-- yang masuk dan yang keluar, dan satu indeks gabungan tidak melayani
-- keduanya.
CREATE INDEX IF NOT EXISTS idx_finance_transfer_dari ON finance_transfer(dari_rekening_id);
CREATE INDEX IF NOT EXISTS idx_finance_transfer_ke ON finance_transfer(ke_rekening_id);
CREATE INDEX IF NOT EXISTS idx_finance_transfer_user ON finance_transfer(user_id, tanggal DESC);
