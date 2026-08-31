-- Nomor pot: satu baris per pot fisik, dan pot mana yang tercakup satu log.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Satu pot fisik.
--
-- Sampai sekarang satu baris garden_plantings dengan quantity 5 adalah satu
-- benda bagi aplikasi, padahal di kebun ia lima pot yang berdiri terpisah.
-- Saat memupuk, dua cabai di dua pot terlihat persis sama di layar — dan
-- itulah yang membuatnya tertukar.
--
-- Dua kunci sengaja dipisah, dan pemisahan itu yang membuat kode boleh diedit
-- tanpa merusak apa pun:
--   unit_no — PERMANEN. Semua relasi menunjuk ini. Tidak pernah berubah dan
--             tidak pernah dipakai ulang dalam satu planting_id.
--   code    — yang TERCETAK di label, dan boleh diubah pengguna. Karena
--             riwayat menunjuk unit_no, mengganti kode hari ini tidak
--             menggeser satu pun catatan perawatan kemarin.
CREATE TABLE IF NOT EXISTS garden_planting_unit (
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kunci deret nomor: satu deret per jenis per pengguna. Disimpan, bukan
  -- diturunkan saat dibaca — nama kustom bisa diedit, dan deret nomornya
  -- tidak boleh ikut pindah kalau itu terjadi.
  species_key TEXT NOT NULL,
  code TEXT NOT NULL,
  -- Pot yang mati atau dibuang. Barisnya TIDAK dihapus: nomornya harus tetap
  -- terpakai supaya nomor otomatis berikutnya tidak menabraknya, dan supaya
  -- riwayat perawatannya tetap punya induk.
  retired_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (planting_id, unit_no)
);
CREATE INDEX IF NOT EXISTS idx_garden_planting_unit_user
  ON garden_planting_unit(user_id, species_key);
CREATE INDEX IF NOT EXISTS idx_garden_planting_unit_planting
  ON garden_planting_unit(planting_id);

-- #2 Pot mana saja yang tercakup satu log perawatan.
--
-- Tabel pendamping, bukan kolom di garden_care_log: ALTER TABLE tidak boleh
-- ada di skrip migrasi yang dijalankan ulang tiap deploy, dan yang lebih
-- penting — log TANPA baris di sini berarti "semua pot". Dengan perjanjian
-- itu, setiap log yang sudah tercatat sebelum fitur nomor pot ada tetap benar
-- artinya, tanpa satu baris pun perlu ditulis ulang.
CREATE TABLE IF NOT EXISTS garden_care_log_unit (
  care_log_id TEXT NOT NULL REFERENCES garden_care_log(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (care_log_id, unit_no)
);
CREATE INDEX IF NOT EXISTS idx_garden_care_log_unit_user
  ON garden_care_log_unit(user_id);

-- #3 Backfill: tiap tanaman yang sudah ada mendapat unit sebanyak quantity.
--
-- Recursive CTE, karena SQLite tidak punya generate_series. Diurutkan
-- planted_date lalu created_at lalu id — deterministik, jadi menjalankan
-- migrasi ini di dua tempat menghasilkan nomor yang sama persis.
--
-- Idempoten lewat NOT EXISTS di akhir: baris yang sudah ada tidak disentuh,
-- termasuk yang kodenya sudah diedit pengguna.
WITH RECURSIVE
  -- quantity dibatasi 200: satu catatan dengan jumlah lebih besar dari itu
  -- hampir pasti salah ketik, dan membuat ribuan baris unit dari satu typo
  -- jauh lebih sulit dibereskan daripada menambahkannya nanti dengan sadar.
  dasar(id, user_id, species_key, qty, urut) AS (
    SELECT
      p.id,
      p.user_id,
      COALESCE(
        NULLIF(TRIM(COALESCE(p.plant_id, '')), ''),
        'nama:' || LOWER(TRIM(COALESCE(NULLIF(TRIM(COALESCE(p.custom_name, '')), ''), 'tanaman')))
      ),
      MIN(MAX(COALESCE(p.quantity, 1), 1), 200),
      ROW_NUMBER() OVER (
        PARTITION BY
          p.user_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(p.plant_id, '')), ''),
            'nama:' || LOWER(TRIM(COALESCE(NULLIF(TRIM(COALESCE(p.custom_name, '')), ''), 'tanaman')))
          )
        ORDER BY p.planted_date, p.created_at, p.id
      )
    FROM garden_plantings p
  ),
  -- Nomor awal tiap catatan = jumlah seluruh pot pada catatan sebelumnya
  -- dalam jenis yang sama. Deret berlanjut lintas catatan, jadi cabai yang
  -- ditanam bulan lalu dan bulan ini tidak sama-sama mulai dari #1.
  awal(id, user_id, species_key, qty, mulai) AS (
    SELECT
      d.id, d.user_id, d.species_key, d.qty,
      COALESCE((
        SELECT SUM(d2.qty) FROM dasar d2
        WHERE d2.user_id = d.user_id
          AND d2.species_key = d.species_key
          AND d2.urut < d.urut
      ), 0)
    FROM dasar d
  ),
  deret(id, user_id, species_key, qty, mulai, n) AS (
    SELECT id, user_id, species_key, qty, mulai, 1 FROM awal
    UNION ALL
    SELECT id, user_id, species_key, qty, mulai, n + 1 FROM deret WHERE n < qty
  )
INSERT INTO garden_planting_unit (planting_id, unit_no, user_id, species_key, code)
SELECT d.id, d.n, d.user_id, d.species_key, CAST(d.mulai + d.n AS TEXT)
FROM deret d
WHERE NOT EXISTS (
  SELECT 1 FROM garden_planting_unit u
  WHERE u.planting_id = d.id AND u.unit_no = d.n
);
