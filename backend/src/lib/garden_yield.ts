/**
 * Prediksi hasil panen (#11).
 *
 * Katalog tidak tahu berapa kg cabai yang akan dipanen dari bedeng tertentu —
 * itu bergantung media, cuaca musim itu, dan jam terbang pengelolanya sendiri.
 * Yang bisa diandalkan justru riwayat panen pengguna sendiri untuk tanaman
 * yang sama, lintas semua penanaman — bukan cuma satu bedeng yang sedang
 * ditanam, supaya baru dua kali panen di bedeng itu tidak membuat prediksi
 * ditolak padahal tanaman yang sama sudah dipanen berkali-kali di bedeng lain.
 */

export interface HarvestSample {
  amount: number;
  unit: string;
  /** YYYY-MM-DD */
  date: string;
}

export type YieldConfidence = 'rendah' | 'sedang' | 'tinggi';

export interface YieldPrediction {
  plantId: string;
  predictedAmount: number;
  unit: string;
  confidence: YieldConfidence;
  /** Jumlah panen konsisten-satuan yang dipakai menghitung keyakinan. */
  sampleSize: number;
  /** Sampel yang disingkirkan karena satuannya beda dari mayoritas. */
  excludedByUnit: number;
}

/** Rata-rata dihitung dari sekian panen terakhir — pola berkebun berubah seiring waktu. */
const RECENT_WINDOW = 5;

/**
 * Prediksi jumlah panen berikutnya dari riwayat panen tanaman yang sama.
 *
 * Mengembalikan null kalau belum ada riwayat sama sekali — tidak ada dasar
 * untuk menebak, dan menebak angka dari nol lebih menyesatkan daripada diam.
 */
export function predictYield(plantId: string, history: HarvestSample[]): YieldPrediction | null {
  if (history.length === 0) return null;

  // Satuan terbanyak yang menang; kg dicampur ikat tidak bermakna dirata-rata.
  const unitCounts = new Map<string, number>();
  for (const h of history) unitCounts.set(h.unit, (unitCounts.get(h.unit) ?? 0) + 1);
  const majorityUnit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const consistent = history.filter((h) => h.unit === majorityUnit);
  const excludedByUnit = history.length - consistent.length;

  const sorted = [...consistent].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-RECENT_WINDOW);
  const predictedAmount = recent.reduce((sum, h) => sum + h.amount, 0) / recent.length;

  const confidence: YieldConfidence =
    consistent.length >= 6 ? 'tinggi' : consistent.length >= 3 ? 'sedang' : 'rendah';

  return {
    plantId,
    predictedAmount: Math.round(predictedAmount * 10) / 10,
    unit: majorityUnit,
    confidence,
    sampleSize: consistent.length,
    excludedByUnit,
  };
}
