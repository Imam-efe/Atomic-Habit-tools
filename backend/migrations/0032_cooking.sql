-- Modul Masakan.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE, karena
-- skrip db:migrate menjalankan ulang setiap berkas pada setiap deploy.

-- Resep yang disimpan pengguna dari saran AI.
--
-- Bahan disimpan sebagai JSON, bukan tabel anak: sebuah resep selalu dibaca
-- utuh dan tidak pernah dikueri per bahan, jadi tabel kedua hanya menambah
-- join tanpa menambah kemampuan apa pun.
CREATE TABLE IF NOT EXISTS cooking_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Bahan yang sudah ada di inventaris saat resep ini disarankan.
  have_json TEXT NOT NULL DEFAULT '[]',
  -- Bahan yang harus dibeli. Ini yang membedakan modul ini dari "Selamatkan
  -- Bahan": di sana bahan kurang tidak boleh ada sama sekali.
  missing_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT NOT NULL DEFAULT '[]',
  minutes INTEGER,
  servings INTEGER,
  note TEXT,
  -- Tanggal terakhir resep ini dimasak; NULL berarti baru disimpan.
  last_cooked_date TEXT,
  cooked_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cooking_recipes_user ON cooking_recipes(user_id, created_at DESC);
