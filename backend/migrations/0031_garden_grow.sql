-- Kebun lanjutan: pembibitan (semai) dan denah bedengan.
--
-- Semua idempoten (CREATE TABLE/INDEX IF NOT EXISTS) sesuai aturan di
-- migrations/README.md, jadi aman dilist di db:migrate yang jalan tiap deploy.
--
-- Fitur lain di rilis ini — perkiraan panen adaptif, kalkulator belanja media,
-- efektivitas treatment hama, dari-kebun-ke-piring, laporan tahunan — semuanya
-- dihitung dari tabel yang sudah ada dan tidak menambah skema.

-- Pembibitan: satu baris per batch semai.
--
-- Dipisah dari garden_plantings karena semai belum tentu jadi tanaman. Yang
-- ingin dipelajari justru selisihnya: berapa disemai vs berapa benar-benar
-- tumbuh, per merek benih. `planting_id` terisi hanya setelah dipindah tanam,
-- dan itulah yang menghubungkan batch ini ke tanaman di kebun.
CREATE TABLE IF NOT EXISTS garden_sowings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT,                            -- id katalog bila dikenali
  name TEXT NOT NULL,                       -- nama tanaman apa adanya
  seed_brand TEXT,                          -- merek/sumber benih, kunci perbandingan
  sown_date TEXT NOT NULL,                  -- YYYY-MM-DD
  seed_count INTEGER NOT NULL,              -- berapa butir/lubang disemai
  -- NULL berarti belum dihitung. 0 adalah jawaban sah: satu batch bisa gagal
  -- total, dan itu justru data terpenting untuk menilai benihnya.
  germinated_count INTEGER,
  germinated_date TEXT,                     -- kapan dihitung
  transplanted_date TEXT,                   -- kapan dipindah ke bedengan
  planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_sowings_user ON garden_sowings(user_id, sown_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_sowings_plant ON garden_sowings(user_id, plant_id);

-- Bedengan/petak: ukuran fisik tempat menanam.
CREATE TABLE IF NOT EXISTS garden_beds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width_cm INTEGER NOT NULL,
  length_cm INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_beds_user ON garden_beds(user_id, created_at);

-- Posisi satu tanaman di dalam satu bedengan.
--
-- Tabel terpisah, bukan kolom di garden_plantings: tidak semua tanaman
-- ditaruh di denah (pot di teras tetap sah tanpa koordinat), dan ALTER TABLE
-- tidak boleh dilist di skrip migrasi yang re-run tiap deploy.
--
-- planting_id jadi primary key: satu tanaman menempati paling banyak satu
-- titik. Memindahnya berarti menimpa baris yang sama, bukan menumpuk.
CREATE TABLE IF NOT EXISTS garden_bed_slots (
  planting_id TEXT PRIMARY KEY REFERENCES garden_plantings(id) ON DELETE CASCADE,
  bed_id TEXT NOT NULL REFERENCES garden_beds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pos_x INTEGER NOT NULL,                   -- cm dari sisi kiri bedengan
  pos_y INTEGER NOT NULL,                   -- cm dari sisi atas bedengan
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_bed_slots_bed ON garden_bed_slots(bed_id);
CREATE INDEX IF NOT EXISTS idx_garden_bed_slots_user ON garden_bed_slots(user_id);
