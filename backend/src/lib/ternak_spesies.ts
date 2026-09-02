/**
 * Satu tempat untuk "spesies penghuni pertama kandang ini".
 *
 * Kueri ini sebelumnya ditulis ulang empat kali (jadwal gabungan, penyesuaian
 * tugas, alat AI, dan kesehatan air) dengan cakupan dan tie-break yang
 * berbeda-beda. Perbedaan itu bukan pilihan desain — ia bug laten: kandang
 * yang penghuni pertamanya belum diisi spesies (animal_id null) bisa
 * menyembunyikan penghuni kedua yang sudah punya spesies, dan dua penghuni
 * yang dicatat di detik yang sama bisa memilih urutan yang beda-beda
 * tergantung kueri mana yang bertanya.
 */

import type { D1Database } from '@cloudflare/workers-types';

/**
 * Spesies (animal_id) penghuni hidup pertama satu kandang, milik satu
 * pengguna.
 *
 * "Pertama" berarti `created_at ASC, id ASC` — dua kunci, bukan satu, supaya
 * dua penghuni yang masuk di detik yang sama tetap punya urutan yang pasti
 * alih-alih jatuh ke urutan penyimpanan SQLite yang kebetulan. `animal_id IS
 * NOT NULL` supaya penghuni tanpa spesies (nama kustom) tidak menyembunyikan
 * penghuni lain di belakangnya yang sebenarnya punya spesies. Kandang tanpa
 * penghuni berspesies mengembalikan null — itu benar, kandang begitu memang
 * tidak punya jadwal tugas kandang apa pun.
 */
export async function spesiesKandang(
  db: D1Database,
  kandangId: string,
  userId: string
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT animal_id FROM ternak_hewan
      WHERE kandang_id = ?1 AND user_id = ?2 AND status = 'hidup' AND animal_id IS NOT NULL
      ORDER BY created_at ASC, id ASC LIMIT 1`
  ).bind(kandangId, userId).first<{ animal_id: string | null }>();
  return row?.animal_id ?? null;
}
