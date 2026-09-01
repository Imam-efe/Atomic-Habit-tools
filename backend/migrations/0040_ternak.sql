-- Modul Ternak: kandang, penghuni, dan perawatannya.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE.

-- #1 Wadah: akuarium, kandang, kolam, atau umbaran.
--
-- Ada sebagai baris tersendiri karena sebagian tugas menempel pada wadah,
-- bukan pada penghuninya. Satu akuarium berisi delapan guppy adalah satu
-- pekerjaan ganti air, bukan delapan.
CREATE TABLE IF NOT EXISTS ternak_kandang (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL,                      -- akuarium | kandang | kolam | umbaran
  habitat TEXT NOT NULL,                    -- darat | air-tawar | air-payau | air-laut
  volume_liter REAL,
  lokasi TEXT,
  tanggal_mulai TEXT NOT NULL,              -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'aktif',     -- aktif | nonaktif
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_kandang_user ON ternak_kandang(user_id, status);

-- #2 Penghuni.
--
-- kandang_id boleh NULL: kucing rumahan tidak berkandang, dan memaksanya
-- punya "kandang bernama Rumah" adalah baris palsu yang harus dijelaskan di
-- setiap layar.
--
-- animal_id boleh NULL: hewan di luar katalog tetap boleh dicatat, ia hanya
-- tidak punya jadwal otomatis — sama dengan tanaman non-katalog di kebun.
--
-- jumlah > 1 berarti satu baris mewakili sekelompok hewan sejenis (tiga puluh
-- lele di satu kolam). Untuk baris seperti itu, ternak_ukur adalah pengukuran
-- CONTOH, bukan sensus.
CREATE TABLE IF NOT EXISTS ternak_hewan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kandang_id TEXT REFERENCES ternak_kandang(id) ON DELETE SET NULL,
  animal_id TEXT,
  nama_kustom TEXT,
  nama_panggilan TEXT,
  jumlah INTEGER NOT NULL DEFAULT 1,
  kelamin TEXT,                             -- jantan | betina | campur | tidak-tahu
  tanggal_lahir TEXT,
  tanggal_masuk TEXT NOT NULL,
  asal TEXT,
  -- Hewan yang mati atau dilepas berhenti dijadwalkan, tapi barisnya tidak
  -- dihapus: riwayat perawatannya satu-satunya bahan untuk tahu apa yang salah.
  status TEXT NOT NULL DEFAULT 'hidup',     -- hidup | mati | dilepas | dijual
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_hewan_user ON ternak_hewan(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ternak_hewan_kandang ON ternak_hewan(kandang_id);

-- #3 Satu tindakan perawatan yang benar-benar dikerjakan.
CREATE TABLE IF NOT EXISTS ternak_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subjek_tipe TEXT NOT NULL,                -- kandang | hewan
  subjek_id TEXT NOT NULL,
  kode_tugas TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  -- Angka opsional yang menyertai tindakan: gram pakan, persen air diganti.
  nilai REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_log_subjek
  ON ternak_log(subjek_id, kode_tugas, tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_ternak_log_user ON ternak_log(user_id, tanggal DESC);

-- #4 Penyimpangan dari katalog.
--
-- Baris di sini HANYA ada kalau pengguna benar-benar mengubah sesuatu. Tidak
-- ada penyalinan tugas saat hewan ditambah, dan itu yang membuat perbaikan
-- katalog langsung sampai ke semua orang alih-alih menyisakan setiap hewan
-- yang sudah terdaftar dengan angka lama.
--
-- kode_tugas yang tidak ada di katalog berarti tugas custom milik subjek ini
-- sendiri; nama_kustom dan cara_kustom wajib terisi untuk baris seperti itu.
CREATE TABLE IF NOT EXISTS ternak_tugas_ubah (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subjek_tipe TEXT NOT NULL,
  subjek_id TEXT NOT NULL,
  kode_tugas TEXT NOT NULL,
  tiap_hari INTEGER,                        -- NULL = ikut katalog
  nonaktif INTEGER NOT NULL DEFAULT 0,
  nama_kustom TEXT,
  cara_kustom TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (subjek_tipe, subjek_id, kode_tugas)
);
CREATE INDEX IF NOT EXISTS idx_ternak_tugas_ubah_user ON ternak_tugas_ubah(user_id);

-- #5 Pertumbuhan.
CREATE TABLE IF NOT EXISTS ternak_ukur (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hewan_id TEXT NOT NULL REFERENCES ternak_hewan(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  berat_gram REAL,
  panjang_cm REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_ukur_hewan ON ternak_ukur(hewan_id, tanggal);

-- #6 Tes air.
--
-- Dipisah dari ternak_log karena ia pengukuran bermatra banyak, bukan
-- tindakan. Menumpangkannya ke kolom `nilai` tunggal akan memaksa enam baris
-- untuk satu kali tes air.
CREATE TABLE IF NOT EXISTS ternak_air (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kandang_id TEXT NOT NULL REFERENCES ternak_kandang(id) ON DELETE CASCADE,
  tanggal TEXT NOT NULL,
  suhu_c REAL,
  ph REAL,
  amonia_ppm REAL,
  nitrit_ppm REAL,
  nitrat_ppm REAL,
  salinitas_ppt REAL,
  catatan TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ternak_air_kandang ON ternak_air(kandang_id, tanggal DESC);
