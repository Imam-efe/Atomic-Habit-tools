-- Modul kebun sayur & buah.
--
-- Katalog tanamannya sendiri TIDAK ada di sini — ia hidup sebagai data
-- ter-bundle di backend/src/data/plants.ts, alasannya sama dengan
-- frontend/src/data/holidays.ts: data referensi yang ditinjau seperti kode dan
-- tidak perlu di-seed ulang tiap deploy. Yang disimpan di D1 hanyalah data
-- milik pengguna, plus cache hasil AI untuk tanaman di luar katalog.

-- Tanaman yang benar-benar ditanam pengguna.
CREATE TABLE IF NOT EXISTS garden_plantings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Slug katalog (plants.ts) ATAU id cache AI (garden_ai_plants). Bukan
  -- foreign key karena sumbernya bisa dua-duanya; validasi di route.
  plant_id TEXT,
  -- Diisi kalau tanamannya di luar katalog dan di luar cache AI.
  custom_name TEXT,
  nickname TEXT,
  location TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  planting_method TEXT,                     -- benih | bibit | stek | umbi
  planted_date TEXT NOT NULL,               -- YYYY-MM-DD
  expected_harvest_date TEXT,               -- dihitung saat dibuat dari katalog
  status TEXT NOT NULL DEFAULT 'tumbuh',    -- tumbuh | panen | selesai | gagal
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_plantings_user ON garden_plantings(user_id, status);

-- Riwayat perawatan: siram, pupuk, panen, pangkas, semprot, catatan.
-- Jadwal berikutnya diturunkan dari baris terakhir per aksi, bukan disimpan,
-- supaya tidak ada dua sumber kebenaran yang bisa berbeda.
CREATE TABLE IF NOT EXISTS garden_care_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                     -- siram | pupuk | panen | pangkas | semprot | catatan
  action_date TEXT NOT NULL,                -- YYYY-MM-DD
  amount REAL,                              -- hasil panen, dsb
  unit TEXT,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_care_planting ON garden_care_log(planting_id, action, action_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_care_user_date ON garden_care_log(user_id, action_date DESC);

-- Cache data tanaman hasil AI untuk yang tidak ada di katalog.
-- Sengaja global (tanpa user_id): isinya fakta botani umum, bukan data
-- pribadi, jadi satu kali panggil AI bisa dipakai semua pengguna — itu
-- justru tujuan cache-nya. Kunci = slug ternormalisasi dari nama tanaman.
CREATE TABLE IF NOT EXISTS garden_ai_plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,                    -- JSON, bentuknya mengikuti Plant di plants.ts
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Dedup push pengingat perawatan, satu baris per tanaman per hari.
CREATE TABLE IF NOT EXISTS garden_care_alert_sent (
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  alert_date TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (planting_id, alert_date)
);
