-- Sepuluh fitur kebun lanjutan, plus denah bedengan yang lebih fleksibel.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE, karena
-- skrip db:migrate menjalankan ulang setiap berkas pada setiap deploy.

-- Penanda bukan-tanaman di denah bedengan: jalan setapak, pot kompos, rak.
--
-- Tabel terpisah dari garden_bed_slots, bukan kolom tambahan di sana: slot
-- terikat pada satu penanaman (planting_id sebagai PRIMARY KEY), sedangkan
-- penanda tidak mewakili tanaman apa pun. Memaksakannya ke bentuk yang sama
-- berarti planting_id palsu atau nullable yang mengacaukan JOIN yang sudah
-- ada.
CREATE TABLE IF NOT EXISTS garden_bed_markers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bed_id TEXT NOT NULL REFERENCES garden_beds(id) ON DELETE CASCADE,
  -- 'jalan', 'kompos', 'rak', atau 'lainnya'.
  kind TEXT NOT NULL DEFAULT 'lainnya',
  label TEXT NOT NULL,
  pos_x INTEGER NOT NULL,
  pos_y INTEGER NOT NULL,
  -- Diperlakukan sebagai lingkaran radius ini, sama seperti tanaman di denah
  -- — satu rumus tabrakan untuk keduanya, bukan dua sistem geometri berbeda.
  radius_cm INTEGER NOT NULL DEFAULT 20,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_bed_markers_bed ON garden_bed_markers(bed_id);

-- Batch kompos: dari sisa dapur/kebun sampai siap dipakai.
--
-- Estimasi siapnya dari metode (cepat/sedang/lambat), bukan dari mengukur
-- suhu tumpukan sungguhan — aplikasi tidak punya sensor itu, dan estimasi
-- kasar yang jujur lebih berguna daripada tanggal yang terlihat presisi
-- padahal dikarang.
CREATE TABLE IF NOT EXISTS garden_compost_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- 'cepat' (~21 hari, kompos panas), 'sedang' (~45 hari), 'lambat' (~90 hari).
  metode TEXT NOT NULL DEFAULT 'sedang',
  started_date TEXT NOT NULL,
  -- Bahan dicatat sebagai teks bebas, bukan ditautkan ke baris Inventaris
  -- tertentu — kompos rumahan bercampur, dan memaksa pemilihan item persis
  -- menambah friksi tanpa menambah kegunaan nyata.
  material_note TEXT,
  -- 'proses', 'siap', atau 'terpakai'.
  status TEXT NOT NULL DEFAULT 'proses',
  -- Terisi kalau kompos sudah diterapkan ke satu penanaman lewat catatan
  -- perawatan (garden_care_log action='pupuk').
  applied_planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  applied_date TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_compost_user ON garden_compost_batches(user_id, status);

-- Tanaman yang ingin dicoba musim depan, sebelum benar-benar ditanam.
CREATE TABLE IF NOT EXISTS garden_wishlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- id katalog kalau ada; nama bebas untuk tanaman di luar katalog.
  plant_id TEXT,
  custom_name TEXT,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_wishlist_user ON garden_wishlist(user_id, created_at DESC);

-- Kapan sebuah bedengan atau lokasi pot dibersihkan sebelum tanam berikutnya.
--
-- Diidentifikasi lewat bed_id ATAU location (teks bebas dari garden_plantings)
-- karena tidak semua tanaman ada di bedengan berkoordinat — banyak yang cukup
-- "pot teras", "rak dapur".
CREATE TABLE IF NOT EXISTS garden_sanitation_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bed_id TEXT REFERENCES garden_beds(id) ON DELETE CASCADE,
  location TEXT,
  cleaned_date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_sanitation_user ON garden_sanitation_log(user_id, cleaned_date DESC);

-- Tampungan air hujan: liter yang masuk dan liter yang dipakai menyiram.
CREATE TABLE IF NOT EXISTS garden_rainwater_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  liters_collected REAL NOT NULL DEFAULT 0,
  liters_used REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_rainwater_user ON garden_rainwater_log(user_id, log_date DESC);

-- Tarif air PDAM per liter, untuk menghitung perkiraan hemat dari air hujan.
--
-- Satu baris per pengguna, sama seperti zakat_settings dan prayer_settings:
-- angkanya diisi pengguna sendiri, bukan ditebak aplikasi, karena tarif air
-- berbeda tiap daerah dan tidak ada API gratis untuk itu.
CREATE TABLE IF NOT EXISTS garden_rainwater_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tariff_rp_per_liter REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
