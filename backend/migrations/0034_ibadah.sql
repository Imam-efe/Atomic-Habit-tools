-- Zakat dan jadwal ibadah.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE, karena
-- skrip db:migrate menjalankan ulang setiap berkas pada setiap deploy.

-- Pengaturan zakat, satu baris per pengguna.
--
-- Harga logam disimpan bersama tanggal terakhir diperbarui: harganya berubah
-- tiap hari dan tidak ada sumber yang bisa dipanggil tanpa kunci API, jadi
-- yang bisa dilakukan aplikasi adalah menampilkan angka basi SEBAGAI angka
-- basi, bukan menyembunyikannya.
CREATE TABLE IF NOT EXISTS zakat_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Harga per gram logam yang dipakai sebagai patokan nisab.
  metal_price_per_gram REAL NOT NULL DEFAULT 0,
  -- 'emas' (85 gram) atau 'perak' (595 gram). Keduanya dipakai pendapat yang
  -- berbeda; aplikasi tidak memilihkan.
  nisab_type TEXT NOT NULL DEFAULT 'emas',
  -- Tanggal harta pertama kali mencapai nisab. Haul dihitung dari sini, bukan
  -- dari awal tahun atau dari kapan pengguna mulai memakai aplikasi.
  haul_start_date TEXT,
  -- Pengurang bulanan untuk zakat penghasilan; 0 berarti dihitung dari kotor.
  income_deduction INTEGER NOT NULL DEFAULT 0,
  price_updated_at TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Zakat yang sudah ditunaikan.
--
-- Dicatat terpisah dari budget_entries meski keduanya pengeluaran: yang
-- dijawab tabel ini adalah "haul tahun ini sudah ditunaikan belum", dan itu
-- pertanyaan yang tidak bisa dijawab oleh baris pengeluaran bertopik apa pun.
CREATE TABLE IF NOT EXISTS zakat_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'maal' atau 'penghasilan'.
  kind TEXT NOT NULL DEFAULT 'maal',
  amount_idr INTEGER NOT NULL,
  paid_date TEXT NOT NULL,
  recipient TEXT,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_zakat_payments_user ON zakat_payments(user_id, paid_date DESC);

-- Pengaturan jadwal salat.
--
-- Lokasinya TIDAK disimpan di sini: garden_location sudah memegang koordinat
-- rumah pengguna, dan menyimpan koordinat kedua berarti dua sumber yang bisa
-- berbeda tanpa ada layar yang bisa menjelaskan mana yang benar. Namanya
-- memang lebih sempit dari isinya sekarang — itu warisan urutan pembangunan,
-- bukan pemisahan yang disengaja.
CREATE TABLE IF NOT EXISTS prayer_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- 'kemenag' (Subuh 20°, Isya 18°) atau 'mwl' (18°/17°).
  method TEXT NOT NULL DEFAULT 'kemenag',
  -- 'syafii' (bayangan 1x) atau 'hanafi' (2x).
  asr_method TEXT NOT NULL DEFAULT 'syafii',
  -- Menit penyesuaian per waktu salat, untuk mencocokkan dengan masjid setempat.
  adjust_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Catatan puasa sunnah yang dijalani.
--
-- Satu baris per hari, dengan tanggal sebagai bagian kunci: menandai hari yang
-- sama dua kali tidak menghasilkan dua catatan.
CREATE TABLE IF NOT EXISTS fasting_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fast_date TEXT NOT NULL,
  -- 'senin-kamis', 'ayyamul-bidh', 'daud', 'arafah', 'asyura', 'syawal', 'lainnya'.
  kind TEXT NOT NULL DEFAULT 'lainnya',
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, fast_date)
);
