/**
 * Skor kesulitan pribadi per tanaman.
 *
 * Katalog sudah punya kolom `difficulty` — tapi itu penilaian umum, sama
 * untuk semua orang. Cabai yang "mudah" menurut katalog bisa saja tiga kali
 * gagal di kebun tertentu karena tanahnya, cuacanya, atau kebiasaan
 * merawatnya sendiri. Skor ini menjawab pertanyaan yang berbeda: bukan
 * "kata orang tanaman ini seberapa sulit", tapi "seberapa sering AKU
 * berhasil menanamnya".
 *
 * Dipisah dari kalibrasi umur panen (garden_calibration.ts) yang menjawab
 * "berapa lama" — ini menjawab "berhasil atau tidak".
 */

export type SkorKesulitan = 'mudah' | 'sedang' | 'sulit';

export interface RiwayatTanam {
  plantId: string;
  /** 'gagal' dihitung gagal; status lain (termasuk masih 'tumbuh') dihitung berhasil sejauh ini. */
  status: string;
}

export interface SkorTanaman {
  plantId: string;
  total: number;
  gagal: number;
  tingkatGagalPercent: number;
  /** null kalau riwayatnya masih terlalu tipis untuk disimpulkan. */
  skor: SkorKesulitan | null;
}

/** Minimum percobaan sebelum skor dianggap berarti — satu kali gagal bukan pola. */
const MIN_PERCOBAAN = 2;

/**
 * Skor kesulitan untuk satu tanaman, dari riwayat penanamannya sendiri.
 *
 * Ambang batasnya diambil dari tingkat gagal, bukan tingkat berhasil, supaya
 * gagal 0 dari 2 percobaan (data tipis tapi kebetulan mulus) tidak langsung
 * disebut "mudah" — itu tetap dihitung, tapi ambang ≥50% gagal untuk "sulit"
 * dan ≤20% untuk "mudah" menyisakan ruang "sedang" yang jujur untuk kasus
 * di tengah.
 */
export function skorUntukTanaman(total: number, gagal: number): SkorTanaman['skor'] {
  if (total < MIN_PERCOBAAN) return null;
  const rate = gagal / total;
  if (rate >= 0.5) return 'sulit';
  if (rate <= 0.2) return 'mudah';
  return 'sedang';
}

/** Kelompokkan riwayat penanaman jadi skor per tanaman. */
export function hitungSkorKesulitan(riwayat: ReadonlyArray<RiwayatTanam>): SkorTanaman[] {
  const byPlant = new Map<string, { total: number; gagal: number }>();

  for (const r of riwayat) {
    const entry = byPlant.get(r.plantId) ?? { total: 0, gagal: 0 };
    entry.total += 1;
    if (r.status === 'gagal') entry.gagal += 1;
    byPlant.set(r.plantId, entry);
  }

  return [...byPlant.entries()].map(([plantId, { total, gagal }]) => ({
    plantId,
    total,
    gagal,
    tingkatGagalPercent: Math.round((gagal / total) * 100),
    skor: skorUntukTanaman(total, gagal),
  }));
}
