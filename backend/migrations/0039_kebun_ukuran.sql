-- Log ukuran tanaman yang diukur sendiri.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.
--
-- Sampai sekarang satu-satunya cara menilai pertumbuhan adalah membandingkan
-- foto lewat AI (`POST /:id/growth-check`). Itu menjawab "kelihatan lebih
-- besar?", bukan "berapa". Angka memberi kurva yang bisa dibandingkan antar
-- musim, dan menangkap tanaman yang mandek jauh sebelum mata sadar —
-- pertumbuhan yang berhenti dua pekan tidak terlihat di dua foto berdampingan.
--
-- unit_no boleh NULL: mengukur satu pot tertentu berguna, tapi memaksa
-- pengguna memilih pot tiap kali mengukur akan membuat fiturnya tidak dipakai.
CREATE TABLE IF NOT EXISTS garden_measurement (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  planting_id TEXT NOT NULL REFERENCES garden_plantings(id) ON DELETE CASCADE,
  -- Pot tertentu di dalam catatan itu, atau NULL untuk "tanamannya" secara
  -- umum. Bukan foreign key ke garden_planting_unit: pot bisa dipensiunkan
  -- sesudah diukur, dan pengukurannya tetap sah sebagai riwayat.
  unit_no INTEGER,
  measured_date TEXT NOT NULL,              -- YYYY-MM-DD
  height_cm REAL,
  leaf_count INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_garden_measurement_planting
  ON garden_measurement(planting_id, measured_date);
CREATE INDEX IF NOT EXISTS idx_garden_measurement_user
  ON garden_measurement(user_id, measured_date DESC);
