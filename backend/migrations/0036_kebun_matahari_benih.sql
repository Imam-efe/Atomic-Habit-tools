-- Peta matahari per lokasi, benih simpanan sendiri, dan silsilahnya.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Berapa jam matahari langsung yang benar-benar didapat satu tempat.
--
-- Katalog sudah menyimpan kebutuhan matahari tiap tanaman (kolom `sunlight`),
-- tapi sampai sekarang tidak ada yang tahu berapa jam yang TERSEDIA di tiap
-- sudut kebun — jadi kebutuhan itu tidak pernah bisa dicocokkan dengan
-- kenyataan. Ini sisi yang hilang.
--
-- Kuncinya `lokasi_id`, memakai perjanjian yang sama dengan peringatan
-- sanitasi: id bedengan apa adanya, atau teks lokasi dengan awalan `loc:`.
-- Satu perjanjian kunci untuk seluruh modul kebun, bukan dua yang harus
-- dijaga tetap sama sendiri-sendiri.
CREATE TABLE IF NOT EXISTS garden_sun_profile (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lokasi_id TEXT NOT NULL,                  -- bed_id, atau 'loc:<teks lokasi>'
  lokasi_label TEXT NOT NULL,               -- nama yang dibaca manusia saat dicatat
  -- Jam matahari LANGSUNG, bukan "terang". Diamati sendiri, bukan dihitung
  -- dari garis lintang: pohon tetangga dan atap tidak ada di peta mana pun.
  hours_direct REAL NOT NULL,
  orientation TEXT,                         -- utara | timur | selatan | barat | campuran
  note TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, lokasi_id)
);

-- #2 Benih yang dipanen sendiri dari tanaman sendiri.
--
-- Terpisah dari `garden_seeds` yang mencatat benih BELI. Keduanya benih, tapi
-- pertanyaannya berbeda: stok benih beli menjawab "masih ada berapa dan kapan
-- kedaluwarsa", benih simpanan menjawab "dari tanaman yang mana, generasi ke
-- berapa, dan galur siapa yang paling kuat di kebun ini".
CREATE TABLE IF NOT EXISTS garden_saved_seed (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Tanaman induknya. ON DELETE SET NULL, bukan CASCADE: menghapus catatan
  -- penanaman lama tidak boleh ikut melenyapkan benih yang masih ada fisiknya
  -- di toples.
  source_planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  plant_id TEXT,                            -- id katalog bila dikenali
  custom_name TEXT,                         -- dipakai kalau di luar katalog
  -- 1 = dipanen dari tanaman yang tumbuh dari benih beli. Tiap kali disimpan
  -- ulang dari keturunannya, bertambah satu. Disimpan tegas, bukan ditelusuri
  -- ulang tiap dibaca: rantainya bisa panjang dan induknya boleh hilang.
  generation INTEGER NOT NULL DEFAULT 1,
  harvested_date TEXT NOT NULL,             -- YYYY-MM-DD
  quantity REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'butir',
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_saved_seed_user ON garden_saved_seed(user_id, harvested_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_saved_seed_source ON garden_saved_seed(source_planting_id);

-- #2b Semai yang berasal dari benih simpanan — penyambung silsilahnya.
--
-- Tabel pendamping, bukan kolom di garden_sowings: tidak semua semai berasal
-- dari benih simpanan (kebanyakan justru dari benih beli), dan ALTER TABLE
-- tidak boleh ada di skrip migrasi yang dijalankan ulang tiap deploy.
CREATE TABLE IF NOT EXISTS garden_sowing_seed_source (
  sowing_id TEXT PRIMARY KEY REFERENCES garden_sowings(id) ON DELETE CASCADE,
  saved_seed_id TEXT NOT NULL REFERENCES garden_saved_seed(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_garden_sowing_seed_source_seed ON garden_sowing_seed_source(saved_seed_id);
