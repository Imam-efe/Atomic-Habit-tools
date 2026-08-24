-- Pengaturan per pengguna.
--
-- Hanya menyimpan yang benar-benar diubah. Nilai bawaan hidup di
-- src/lib/settings_schema.ts, bukan di sini — jadi memperbaiki bawaan di kode
-- langsung berlaku bagi semua yang belum menyentuh pengaturan itu, tanpa
-- migrasi data dan tanpa seed yang harus jalan tiap deploy.
--
-- Nilainya JSON supaya boolean, angka, dan string bisa memakai satu kolom
-- tanpa kehilangan tipe.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, key)
);
