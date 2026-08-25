-- Jejak, pembatalan, dan batas pemakaian untuk agen AI.
--
-- Semua idempoten (lihat migrations/README.md) — tidak ada ALTER TABLE, karena
-- skrip db:migrate menjalankan ulang setiap berkas pada setiap deploy.

-- Setiap aksi yang benar-benar dijalankan agen.
--
-- Dua kebutuhan sekaligus, dan sengaja satu tabel karena keduanya menjawab
-- pertanyaan yang sama:
--
--   "Apa yang barusan AI lakukan?"  — agen menulis langsung ke delapan tabel,
--   dan tanpa jejak ini data yang muncul tiba-tiba tidak bisa ditelusuri.
--
--   "Batalkan."                     — id baris yang dibuat disimpan di sini,
--   jadi membatalkan tidak perlu menebak apa pun.
CREATE TABLE IF NOT EXISTS agent_actions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  module TEXT NOT NULL,
  -- Permintaan aslinya, supaya riwayat bisa menjelaskan kenapa aksi ini terjadi.
  message TEXT,
  args_json TEXT NOT NULL DEFAULT '{}',
  -- Id baris yang dibuat aksi ini, di tabel milik alatnya.
  row_ids_json TEXT NOT NULL DEFAULT '[]',
  -- Keadaan sebelumnya yang perlu dipulihkan saat dibatalkan; alat yang tidak
  -- punya efek samping membiarkannya kosong.
  undo_meta_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  -- 'dijalankan' atau 'dibatalkan'.
  status TEXT NOT NULL DEFAULT 'dijalankan',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  undone_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_actions_user ON agent_actions(user_id, created_at DESC);

-- Pemakaian AI per pengguna per hari.
--
-- Workers AI gratis 10.000 neuron/hari untuk seluruh akun, dan AI sekarang bisa
-- dipanggil dari sembilan layar plus cron. Kuota habis membuat SEMUA fitur AI
-- mati tanpa pesan — bentuk kegagalan yang sudah dua kali terjadi di aplikasi
-- ini. Hitungan ini yang membuatnya bisa dilihat sebelum terjadi.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,                        -- YYYY-MM-DD menurut WIB
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Jawaban AI yang boleh dipakai ulang sebentar.
--
-- "Apa yang bisa dimasak hari ini?" ditanya berkali-kali dalam satu sore
-- dengan isi kulkas yang sama. Kuncinya menyertakan ringkasan data yang
-- dikirim, jadi begitu datanya berubah jawabannya ikut berubah.
--
-- Hanya untuk pertanyaan; aksi yang menulis tidak pernah di-cache.
CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_user ON ai_cache(user_id, created_at);
