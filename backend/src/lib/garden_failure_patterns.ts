/**
 * Pelacak pola gagal panen berulang (#12).
 *
 * Satu tanaman gagal itu wajar. Tanaman yang sama gagal berkali-kali di kebun
 * yang sama bukan nasib buruk — itu pola, dan kebunnya sendiri yang menyimpan
 * petunjuknya: lokasi yang sama, bulan tanam yang sama, atau insiden hama yang
 * selalu menyertainya. Ini menyilangkan ketiganya, bukan sekadar menghitung
 * berapa kali gagal.
 */

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export interface FailedPlanting {
  plantingId: string;
  plantId: string;
  label: string;
  location: string | null;
  /** Bulan tanam, 1–12. */
  month: number;
  /** True kalau ada catatan hama untuk penanaman ini. */
  hadPestIncident: boolean;
}

export interface FailurePattern {
  plantId: string;
  label: string;
  failureCount: number;
  /** Lokasi yang muncul pada lebih dari separuh kegagalan ini; null kalau tersebar/seri. */
  commonLocation: string | null;
  /** Bulan yang muncul pada lebih dari separuh kegagalan ini; null kalau tersebar/seri. */
  commonMonth: number | null;
  /** Proporsi kegagalan yang disertai catatan hama, 0–1. */
  pestShare: number;
  hypotheses: string[];
}

/**
 * Nilai yang muncul pada lebih dari separuh entri, atau null kalau tidak ada
 * yang dominan.
 *
 * Sengaja "lebih dari" (bukan "≥") separuh: dua lokasi berbeda yang masing-
 * masing muncul sekali dari dua entri adalah seri 50/50, bukan pola — memilih
 * salah satunya begitu saja (pemenang seri berdasar urutan Map) akan
 * melaporkan lokasi yang salah seolah-olah itu penyebabnya.
 */
function majority<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v === null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, n] of counts.entries()) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return bestCount * 2 > values.length ? best : null;
}

/**
 * Kelompokkan kegagalan per tanaman dan cari pola bersama.
 *
 * Hanya penanaman berkatalog yang dikelompokkan — tanaman kustom di luar
 * katalog tidak punya id stabil untuk disilangkan tanpa risiko menyamakan dua
 * tanaman berbeda yang kebetulan namanya mirip.
 */
export function findFailurePatterns(failures: FailedPlanting[]): FailurePattern[] {
  const byPlant = new Map<string, FailedPlanting[]>();
  for (const f of failures) {
    const list = byPlant.get(f.plantId) ?? [];
    list.push(f);
    byPlant.set(f.plantId, list);
  }

  const patterns: FailurePattern[] = [];

  for (const [plantId, group] of byPlant.entries()) {
    // Satu kegagalan bukan pola — belum ada yang berulang untuk disilangkan.
    if (group.length < 2) continue;

    const commonLocation = majority(group.map((g) => g.location));
    const commonMonth = majority(group.map((g) => g.month));
    const pestCount = group.filter((g) => g.hadPestIncident).length;
    const pestShare = pestCount / group.length;

    const hypotheses: string[] = [];
    if (commonLocation) {
      hypotheses.push(
        `Gagal ${group.length} kali, hampir semuanya di lokasi "${commonLocation}" — kemungkinan masalah tanah atau drainase di situ, bukan tanamannya.`
      );
    }
    if (commonMonth) {
      hypotheses.push(
        `Sebagian besar ditanam bulan ${MONTH_NAMES[commonMonth - 1]} — kemungkinan kurang cocok ditanam musim itu.`
      );
    }
    if (pestShare >= 0.5) {
      hypotheses.push(
        `${pestCount} dari ${group.length} kegagalan disertai catatan hama — cek riwayat hama sebelum tanam ulang di sana.`
      );
    }
    if (hypotheses.length === 0) {
      hypotheses.push(
        `Gagal ${group.length} kali tanpa pola lokasi, musim, atau hama yang jelas — coba variasi media tanam atau sumber bibit.`
      );
    }

    patterns.push({
      plantId,
      label: group[0].label,
      failureCount: group.length,
      commonLocation,
      commonMonth,
      pestShare: Math.round(pestShare * 100) / 100,
      hypotheses,
    });
  }

  // Yang paling sering gagal paling mendesak dilihat.
  return patterns.sort((a, b) => b.failureCount - a.failureCount);
}
