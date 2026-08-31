/**
 * Tanaman yang lama tidak disentuh sama sekali.
 *
 * Modul kebun sudah punya `overdueDays` per aksi — telat siram, telat pupuk —
 * tapi tidak ada satu pun sinyal yang menjawab "tanaman ini sudah tiga pekan
 * tidak kamu sentuh". Bedanya penting: telat siram lima hari muncul dan hilang
 * setiap pekan, jadi ia berhenti dibaca. Yang mati di kebun rumahan biasanya
 * bukan yang salah rawat, melainkan yang lupa ada.
 */

/** Lebih lama dari ini tanpa satu pun catatan perawatan sudah patut ditanya. */
export const AMBANG_TERLANTAR = 21;

export interface Sentuhan {
  plantingId: string;
  nama: string;
  /** Tanggal perawatan terakhir apa pun jenisnya; null bila belum pernah. */
  lastCare: string | null;
  plantedDate: string;
}

export interface Terlantar extends Sentuhan {
  hariDiam: number;
}

function selisihHari(dari: string, ke: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${ke}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Tanaman yang diam lebih lama daripada ambang.
 *
 * Yang belum pernah dirawat dihitung dari tanggal tanamnya, bukan dilewati:
 * tanaman yang tidak disentuh sejak hari ia ditanam adalah kasus terparah,
 * dan justru itu yang akan lolos kalau `lastCare` null diperlakukan sebagai
 * "tidak ada data".
 */
export function cariTerlantar(
  rows: Sentuhan[],
  hariIni: string,
  ambang: number = AMBANG_TERLANTAR
): Terlantar[] {
  return rows
    .map((r) => ({ ...r, hariDiam: selisihHari(r.lastCare ?? r.plantedDate, hariIni) }))
    // Lebih dari ambang, bukan sama dengan: pada hari perbatasan tanaman akan
    // berkedip masuk-keluar daftar, dan daftar yang berkedip tidak dipercaya.
    .filter((r) => r.hariDiam > ambang)
    .sort((a, b) => b.hariDiam - a.hariDiam);
}
