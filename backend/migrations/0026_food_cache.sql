-- Cache lintas-user untuk hasil resolusi gizi (Open Food Facts + AI).
--
-- Lintas-user dengan sengaja: isinya fakta produk publik ("Indomie goreng
-- punya X kalori per sajian"), bukan data pribadi — satu pengguna men-scan
-- sebuah produk, semua pengguna lain yang mengetik nama sama diuntungkan.
-- Ini beda dari food_logs yang tetap ketat per user_id.
--
-- TTL 90 hari dicek at-read di kode (fetched_at < now - 90*86400 => treat
-- sebagai miss), bukan job pembersih terpisah — konsisten dengan cara
-- garden_ai_plants sudah ditangani, tidak perlu infrastruktur cron baru.
CREATE TABLE IF NOT EXISTS food_facts_cache (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- 'off' | 'ai'
  lookup_key TEXT NOT NULL,      -- barcode untuk 'off', nama ternormalisasi untuk 'ai'
  name TEXT NOT NULL,
  brand TEXT,
  serving_size TEXT,
  calories REAL NOT NULL,
  protein REAL NOT NULL,
  carbs REAL NOT NULL,
  fat REAL NOT NULL,
  fiber REAL NOT NULL,
  sodium REAL NOT NULL,
  sugar REAL NOT NULL,
  fetched_at INTEGER NOT NULL,
  UNIQUE(source, lookup_key)
);

CREATE INDEX IF NOT EXISTS idx_food_cache_lookup ON food_facts_cache(source, lookup_key);
