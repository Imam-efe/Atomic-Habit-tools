/**
 * Pembacaan pengaturan.
 *
 * Yang tersimpan di database hanya nilai yang benar-benar diubah pengguna;
 * sisanya diambil dari registry. Jadi mengubah nilai bawaan di kode langsung
 * berlaku bagi semua orang yang belum menyentuh pengaturan itu.
 */

import { SETTINGS, SETTING_BY_KEY, coerceSetting, type SettingValue } from './settings_schema';

export type ResolvedSettings = Record<string, SettingValue>;

/** Semua nilai bawaan, tanpa menyentuh database. */
export function defaultSettings(): ResolvedSettings {
  const out: ResolvedSettings = {};
  for (const def of SETTINGS) out[def.key] = def.default;
  return out;
}

/**
 * Pengaturan seorang pengguna, bawaan digabung dengan yang ia ubah.
 *
 * Baris yang kuncinya tidak dikenal lagi diabaikan, bukan dibuang dari
 * database: menghapus pengaturan dari registry lalu mengembalikannya nanti
 * tidak boleh menghilangkan pilihan pengguna yang lama.
 */
export async function loadSettings(db: D1Database, userId: string): Promise<ResolvedSettings> {
  const resolved = defaultSettings();

  const rows = await db
    .prepare('SELECT key, value FROM user_settings WHERE user_id = ?1')
    .bind(userId)
    .all<{ key: string; value: string }>();

  for (const row of rows.results ?? []) {
    const def = SETTING_BY_KEY.get(row.key);
    if (!def) continue;

    try {
      const coerced = coerceSetting(def, JSON.parse(row.value));
      // Nilai tersimpan yang sudah di luar batas — misalnya karena batasnya
      // diperketat belakangan — jatuh kembali ke bawaan, bukan dipakai apa
      // adanya dan merusak fitur.
      if (coerced !== null) resolved[row.key] = coerced;
    } catch {
      // JSON rusak: biarkan bawaan yang menang.
    }
  }

  return resolved;
}

/** Pengaturan untuk banyak pengguna sekaligus, dipakai cron. */
export async function loadSettingsFor(
  db: D1Database,
  userIds: string[]
): Promise<Map<string, ResolvedSettings>> {
  const map = new Map<string, ResolvedSettings>();
  for (const id of userIds) map.set(id, defaultSettings());
  if (userIds.length === 0) return map;

  const placeholders = userIds.map((_, i) => `?${i + 1}`).join(',');
  const rows = await db
    .prepare(`SELECT user_id, key, value FROM user_settings WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .all<{ user_id: string; key: string; value: string }>();

  for (const row of rows.results ?? []) {
    const def = SETTING_BY_KEY.get(row.key);
    const target = map.get(row.user_id);
    if (!def || !target) continue;

    try {
      const coerced = coerceSetting(def, JSON.parse(row.value));
      if (coerced !== null) target[row.key] = coerced;
    } catch {
      /* biarkan bawaan */
    }
  }

  return map;
}

/** Pembaca bertipe, supaya pemanggil tidak menebak bentuk nilainya. */
export const num = (s: ResolvedSettings, key: string): number => {
  const v = s[key];
  return typeof v === 'number' ? v : Number(SETTING_BY_KEY.get(key)?.default ?? 0);
};

export const bool = (s: ResolvedSettings, key: string): boolean => {
  const v = s[key];
  return typeof v === 'boolean' ? v : Boolean(SETTING_BY_KEY.get(key)?.default ?? false);
};

/** Simpan satu pengaturan. Mengembalikan false kalau nilainya ditolak. */
export async function saveSetting(
  db: D1Database,
  userId: string,
  key: string,
  raw: unknown
): Promise<boolean> {
  const def = SETTING_BY_KEY.get(key);
  if (!def) return false;

  const coerced = coerceSetting(def, raw);
  if (coerced === null) return false;

  // Nilai yang sama persis dengan bawaan tidak disimpan — dihapus. Dengan
  // begitu pengguna tetap ikut kalau bawaannya diperbaiki di kemudian hari.
  if (coerced === def.default) {
    await db
      .prepare('DELETE FROM user_settings WHERE user_id = ?1 AND key = ?2')
      .bind(userId, key)
      .run();
    return true;
  }

  await db
    .prepare(
      `INSERT INTO user_settings (user_id, key, value, updated_at)
       VALUES (?1, ?2, ?3, unixepoch())
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(userId, key, JSON.stringify(coerced))
    .run();

  return true;
}
