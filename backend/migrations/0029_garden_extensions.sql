-- Perluasan modul kebun: pendamping, panen ke stok, ekonomi, hama, cuaca,
-- foto, benih, dan tanam bergilir.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #2 Panen jadi stok Inventaris.
--
-- Kunci utamanya care_log_id, bukan id sendiri: satu baris panen hanya boleh
-- melahirkan satu item stok. Tanpa itu, memanggil ulang endpoint perawatan
-- akan menggandakan stok diam-diam.
CREATE TABLE IF NOT EXISTS garden_harvest_stock (
  care_log_id TEXT PRIMARY KEY REFERENCES garden_care_log(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- #3 Biaya per penanaman.
CREATE TABLE IF NOT EXISTS garden_costs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Boleh NULL: biaya umum seperti pupuk sekarung dipakai banyak tanaman.
  planting_id TEXT REFERENCES garden_plantings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- benih | pupuk | media | pot | pestisida | lainnya
  amount_idr INTEGER NOT NULL,
  note TEXT,
  cost_date TEXT NOT NULL,                  -- YYYY-MM-DD
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_costs_user ON garden_costs(user_id, cost_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_costs_planting ON garden_costs(planting_id);

-- #3 Harga pasar per tanaman, diisi pengguna.
--
-- Tidak di-bundle bersama katalog: harga sayur berbeda antar kota dan berubah
-- tiap musim, jadi angka yang ditulis di kode akan salah bagi hampir semua
-- orang. Lebih jujur meminta sekali daripada menebak terus.
CREATE TABLE IF NOT EXISTS garden_plant_price (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_key TEXT NOT NULL,                  -- id katalog atau nama kustom ternormalisasi
  price_idr INTEGER NOT NULL,               -- harga per satuan di bawah
  unit TEXT NOT NULL DEFAULT 'kg',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, plant_key)
);

-- #4 Catatan hama.
CREATE TABLE IF NOT EXISTS garden_pest_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  pest TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'sedang',  -- ringan | sedang | berat
  treatment TEXT,
  spotted_date TEXT NOT NULL,               -- YYYY-MM-DD
  -- Diisi saat teratasi. Yang membuat catatan ini berguna musim depan adalah
  -- tahu tindakan mana yang berhasil, bukan sekadar hamanya apa.
  resolved_date TEXT,
  worked INTEGER,                           -- NULL belum dinilai, 0 gagal, 1 berhasil
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_pest_user ON garden_pest_log(user_id, spotted_date DESC);
CREATE INDEX IF NOT EXISTS idx_garden_pest_planting ON garden_pest_log(planting_id);

-- #8 Jurnal foto.
--
-- Gambar disimpan sebagai data URL di D1, mengikuti budget_entries.receipt_img.
-- R2 sebetulnya pilihan yang benar, tapi belum aktif di akun ini, dan binding
-- ke bucket yang tidak ada menggagalkan deploy Worker. Klien mengompresi
-- sebelum kirim. Kalau R2 diaktifkan nanti, kolom image berganti jadi kunci R2
-- tanpa mengubah bentuk API.
CREATE TABLE IF NOT EXISTS garden_photos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  image TEXT NOT NULL,
  taken_date TEXT NOT NULL,                 -- YYYY-MM-DD
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_photos_planting ON garden_photos(planting_id, taken_date DESC);

-- #9 Stok benih dan bibit.
CREATE TABLE IF NOT EXISTS garden_seeds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT,                            -- id katalog bila dikenali
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'bungkus',
  purchase_date TEXT,
  expiry_date TEXT,                         -- daya tumbuh benih menurun seiring waktu
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_seeds_user ON garden_seeds(user_id, expiry_date);

-- #5 Lokasi pengguna untuk cuaca. Satu baris per pengguna.
CREATE TABLE IF NOT EXISTS garden_location (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  label TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- #5 Cache cuaca harian.
--
-- Cron menyala tiap menit dan Open-Meteo membatasi 10.000 panggilan per hari;
-- tanpa cache, satu pengguna saja sudah menghabiskan kuota dalam seminggu.
-- Kunci dibulatkan per dua desimal (~1 km) supaya pergeseran GPS kecil tidak
-- membuat cache meleset terus.
CREATE TABLE IF NOT EXISTS garden_weather_cache (
  cache_key TEXT PRIMARY KEY,               -- "{lat}:{lon}:{tanggal}"
  payload TEXT NOT NULL,                    -- JSON dari Open-Meteo
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);
