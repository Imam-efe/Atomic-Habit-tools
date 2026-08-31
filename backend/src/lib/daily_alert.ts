/**
 * Dedup untuk push harian.
 *
 * Cron menyala tiap menit, jadi tiap pengirim butuh penanda "sudah dikirim hari
 * ini". Fitur lama memakai kolom sendiri di tabel domainnya; itu jalan buntu
 * karena ALTER TABLE ADD COLUMN tidak idempoten dan migrasi diulang tiap deploy
 * (lihat migrations/README.md). Semua alert baru berbagi satu tabel.
 */

export type AlertKind =
  | 'morning_brief'
  | 'bill_radar'
  | 'kids_prep'
  | 'miss_twice'
  | 'succession'
  | 'garden_followup'
  | 'harvest_due'
  | 'garden_solution'
  | 'garden_mangsa';

/**
 * Klaim hak kirim untuk (user, kind, tanggal).
 *
 * Mengembalikan true kalau pemanggil ini yang berhasil klaim. INSERT kedua di
 * hari yang sama gagal karena primary key, dan kegagalan itulah penandanya —
 * jadi dua tick cron yang tumpang tindih tidak bisa mengirim dua kali.
 */
export async function claimDailyAlert(
  db: D1Database,
  userId: string,
  kind: AlertKind,
  date: string
): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO daily_alert_sent (user_id, kind, alert_date) VALUES (?1, ?2, ?3)')
      .bind(userId, kind, date)
      .run();
    return true;
  } catch {
    return false;
  }
}

/** Lepas klaim, dipakai kalau pengiriman gagal sehingga besok masih bisa dicoba. */
export async function releaseDailyAlert(
  db: D1Database,
  userId: string,
  kind: AlertKind,
  date: string
): Promise<void> {
  await db
    .prepare('DELETE FROM daily_alert_sent WHERE user_id = ?1 AND kind = ?2 AND alert_date = ?3')
    .bind(userId, kind, date)
    .run();
}
