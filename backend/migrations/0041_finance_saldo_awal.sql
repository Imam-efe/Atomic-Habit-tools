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
