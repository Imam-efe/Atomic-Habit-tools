-- Saldo pembuka per rekening.
--
-- Sampai sekarang `bank_accounts.balance` adalah total berjalan yang
-- dipelihara tangan di dua belas tempat (routes/budget.ts, routes/debts.ts,
-- dan cron transaksi berulang di index.ts). Satu jalur tulis yang lupa
-- menyesuaikannya membuat saldo melenceng diam-diam, dan selisih itu tidak
-- bisa diperbaiki karena tidak ada titik awal untuk menghitung ulang.
--
-- Tabel ini memberi titik awal itu. Sesudahnya saldo jadi turunan:
--
--   saldo = saldo_awal + jumlah seluruh mutasi di budget_entries
--
-- Invarian itu berlaku untuk SEMUA uang yang bergerak, bukan cuma pemasukan
-- dan pengeluaran biasa: pembayaran hutang pun menulis baris budget_entries
-- sendiri dengan tanda yang sama (lihat arahUang di routes/debts.ts), jadi
-- menjumlahkan budget_entries sudah mencakupnya. Diverifikasi satu per satu
-- terhadap kedua belas situs mutasi sebelum tabel ini ditulis.
CREATE TABLE IF NOT EXISTS finance_saldo_awal (
  -- Satu baris per rekening, jadi id rekening sekalian jadi kunci utama:
  -- dua saldo pembuka untuk satu rekening tidak punya arti.
  bank_account_id TEXT PRIMARY KEY REFERENCES bank_accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Rupiah bulat, mengikuti amount_idr. Boleh negatif: kartu kredit dan
  -- rekening yang sudah minus sejak awal adalah keadaan yang sah.
  saldo_awal_idr INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_finance_saldo_awal_user ON finance_saldo_awal(user_id);

-- Semai titik awal untuk rekening yang sudah ada, saat deploy.
--
-- Nilainya diturunkan MUNDUR dari keadaan sekarang: saldo tersimpan dikurangi
-- seluruh mutasi yang sudah tercatat. Jadi saldo hasil hitungan sama persis
-- dengan angka yang selama ini dilihat pengguna — tidak ada angka yang berubah
-- di layar saat modul ini menyala.
--
-- Penyemaian sengaja dilakukan DI SINI, bukan hanya saat aplikasi pertama kali
-- membaca saldo. Kalau menunggu pembacaan pertama, transaksi yang masuk antara
-- deploy dan pembacaan itu akan ikut terkurangi dari titik awal dan efeknya
-- terserap diam-diam — satu transaksi hilang tanpa jejak. Migrasi berjalan
-- sebelum Worker terpasang, jadi tidak ada celah itu.
--
-- INSERT OR IGNORE: kunci utamanya bank_account_id, jadi deploy berikutnya
-- tidak menimpa titik awal yang sudah dipakai. Bentuk ini terdaftar aman di
-- migrations/README.md.
INSERT OR IGNORE INTO finance_saldo_awal (bank_account_id, user_id, saldo_awal_idr)
SELECT b.id, b.user_id,
       b.balance - COALESCE((
         SELECT SUM(CASE WHEN e.type = 'expense' THEN -e.amount_idr ELSE e.amount_idr END)
           FROM budget_entries e
          WHERE e.bank_account_id = b.id AND e.user_id = b.user_id
       ), 0)
  FROM bank_accounts b;
