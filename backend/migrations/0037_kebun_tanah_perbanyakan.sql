-- Uji tanah per lokasi, catatan perbanyakan, dan media tanam non-tanah.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Hasil uji tanah di satu lokasi.
--
-- Katalog menyimpan `phRange` ideal tiap tanaman sejak berkas plants.ts
-- ditulis, tapi sampai sekarang angka itu tidak pernah dibandingkan dengan apa
-- pun: tidak ada tempat menyimpan pH tanah yang SEBENARNYA di kebun ini. Ini
-- sisi yang hilang, persis seperti jam matahari sebelum garden_sun_profile ada.
--
-- Kuncinya `lokasi_id`, memakai perjanjian yang sama dengan peta matahari dan
-- peringatan sanitasi: id bedengan apa adanya, atau teks lokasi dengan awalan
-- `loc:`. Satu perjanjian kunci untuk seluruh modul kebun.
--
-- Satu baris per pengujian, bukan satu baris per lokasi: pH bergerak setelah
-- tanah dikapur atau dipupuk, dan yang berguna justru melihat arah geraknya.
CREATE TABLE IF NOT EXISTS garden_soil_test (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lokasi_id TEXT NOT NULL,                  -- bed_id, atau 'loc:<teks lokasi>'
  lokasi_label TEXT NOT NULL,               -- nama yang dibaca manusia saat dicatat
  ph REAL NOT NULL,
  -- Tekstur ikut dicatat karena ia yang menentukan dosis saran: tanah pasir
  -- hampir tidak menyangga perubahan pH, tanah liat menyangga kuat. Dosis
  -- kapur yang sama akan melampaui target di pasir dan tidak terasa di liat.
  texture TEXT,                             -- pasir | lempung | liat
  tested_date TEXT NOT NULL,                -- YYYY-MM-DD
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_soil_test_user
  ON garden_soil_test(user_id, lokasi_id, tested_date DESC);

-- #2 Percobaan perbanyakan: stek, cangkok, okulasi, anakan, rimpang.
--
-- Kolom `propagation` di katalog selama ini hanya dirender sebagai satu baris
-- teks di modal detail. Ia memberi tahu CARA memperbanyak, tapi tidak ada yang
-- mencatat apakah caranya berhasil di tangan pengguna ini — padahal justru itu
-- yang membedakan panduan umum dari pengalaman sendiri.
--
-- Tabel ini yang menutup lingkaran modul kebun sepenuhnya:
--   benih -> tanam -> panen -> benih ATAU stek -> tanam.
--
-- source_planting_id ON DELETE SET NULL, bukan CASCADE: menghapus catatan
-- tanaman induk tidak boleh ikut melenyapkan stek yang sudah berakar di
-- polybag dan masih hidup.
CREATE TABLE IF NOT EXISTS garden_propagation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT,                            -- id katalog bila dikenali
  custom_name TEXT,                         -- dipakai kalau di luar katalog
  source_planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  method TEXT NOT NULL,                     -- stek | cangkok | okulasi | anakan | rimpang | umbi | daun
  started_date TEXT NOT NULL,               -- YYYY-MM-DD
  count_started INTEGER NOT NULL,
  -- NULL berarti belum dihitung. 0 adalah jawaban sah dan justru yang paling
  -- penting: satu batch stek bisa gagal total, dan itu data tentang metodenya,
  -- bukan data yang hilang.
  count_rooted INTEGER,
  rooted_date TEXT,
  -- Diisi kalau stek yang jadi akhirnya ditanam sebagai tanaman baru.
  planting_id TEXT REFERENCES garden_plantings(id) ON DELETE SET NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_user
  ON garden_propagation(user_id, started_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_propagation_plant
  ON garden_propagation(user_id, plant_id);

-- #3 Media tanam satu penanaman, kalau bukan tanah biasa.
--
-- Tabel pendamping, bukan kolom di garden_plantings: kebanyakan penanaman
-- memang di tanah atau polybag dan tidak perlu baris di sini sama sekali, dan
-- ALTER TABLE tidak boleh ada di skrip migrasi yang dijalankan ulang tiap
-- deploy.
--
-- Yang berubah bukan sekadar label. Seluruh modul kebun sampai sekarang
-- mengandaikan tanah: `waterIntervalDays` di katalog berarti "siram tiap N
-- hari". Untuk hidroponik kalimat itu bukan kurang tepat, melainkan salah —
-- akarnya memang selalu di dalam air, dan yang perlu dikerjakan adalah
-- mengganti larutannya sebelum garamnya menumpuk.
CREATE TABLE IF NOT EXISTS garden_planting_media (
  planting_id TEXT PRIMARY KEY REFERENCES garden_plantings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media TEXT NOT NULL,                      -- tanah | polybag | hidroponik | vertikultur | tabulampot
  -- Hanya berarti untuk hidroponik; NULL untuk media lain.
  last_solution_change TEXT,                -- YYYY-MM-DD
  note TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_planting_media_user
  ON garden_planting_media(user_id, media);
