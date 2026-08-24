-- Fondasi untuk rangkaian fitur harian: Pagi Ini, Radar Tagihan, Besok Anak,
-- Jangan Bolos Dua Kali, Tutup Hari, dan jembatan Apple Health.
--
-- Semua idempoten (lihat migrations/README.md) — file ini ikut dijalankan ulang
-- tiap deploy, jadi tidak ada ALTER TABLE ADD COLUMN di sini.

-- Dedup push harian, satu tabel untuk semua jenis alert baru.
--
-- Pola lama menambah kolom "<fitur>_alert_sent" ke tabel domainnya
-- (expiry_alert_sent, streak_alert_sent, ...). Itu tidak bisa diteruskan:
-- ADD COLUMN tidak idempoten, jadi tiap fitur baru akan menggagalkan deploy.
-- Kunci gabungannya membuat INSERT kedua di hari yang sama gagal, dan cron
-- memakai kegagalan itu sebagai penanda "sudah dikirim" — sama seperti
-- calendar_reminder_sent dan garden_care_alert_sent.
CREATE TABLE IF NOT EXISTS daily_alert_sent (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- morning_brief | bill_radar | kids_prep | miss_twice
  alert_date TEXT NOT NULL,                 -- YYYY-MM-DD, tanggal Jakarta
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, kind, alert_date)
);

-- Metrik kesehatan yang dikirim dari Apple Health lewat Automation Shortcuts.
--
-- Satu baris per (user, tanggal, metrik) supaya kiriman ulang di hari yang sama
-- menimpa, bukan menumpuk — Automation iOS bisa jalan lebih dari sekali dan
-- angka terakhir yang paling benar.
CREATE TABLE IF NOT EXISTS health_metrics (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,                -- YYYY-MM-DD
  metric TEXT NOT NULL,                     -- sleep_minutes | steps | resting_hr | active_energy | weight_kg
  value REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'shortcuts',
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, metric_date, metric)
);
CREATE INDEX IF NOT EXISTS idx_health_metrics_user_date
  ON health_metrics(user_id, metric_date DESC);

-- Ritual Tutup Hari: satu baris per hari.
--
-- Prioritas besok disimpan sebagai JSON array pendek, bukan tabel terpisah:
-- isinya selalu dibaca dan ditulis sekaligus sebagai satu daftar, tidak pernah
-- dikueri per item, jadi tabel anak hanya menambah join tanpa manfaat.
CREATE TABLE IF NOT EXISTS daily_shutdown (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shutdown_date TEXT NOT NULL,              -- YYYY-MM-DD
  journal TEXT,                             -- satu baris refleksi
  mood INTEGER,                             -- 1..5, opsional
  top_priorities TEXT,                      -- JSON array of string, maks 3
  completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, shutdown_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_shutdown_user_date
  ON daily_shutdown(user_id, shutdown_date DESC);
