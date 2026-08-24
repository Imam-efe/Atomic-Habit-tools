/**
 * Peringatan dini hama dari pola cuaca (#16).
 *
 * Data cuaca yang sudah diambil untuk keputusan siram (#5) dipakai ulang di
 * sini: hujan tiga hari berturut-turut yang tinggi menandakan kondisi lembap
 * yang disukai jamur, busuk, dan siput; tiga hari kering berarti kondisi
 * hangat yang disukai kutu daun dan tungau. Tidak butuh sumber data baru,
 * hanya sudut pandang baru atas data yang sudah ada.
 */

export type PestRiskCondition = 'lembap' | 'kering';

export interface PestRiskAssessment {
  condition: PestRiskCondition | null;
  reason: string;
  /** Kata kunci hama/penyakit yang relevan untuk kondisi ini. */
  keywords: string[];
}

const WET_KEYWORDS = ['busuk', 'jamur', 'bercak', 'karat', 'antraknosa', 'rebah semai', 'siput', 'embun'];
const DRY_KEYWORDS = ['kutu daun', 'kutu putih', 'kutu kebul', 'trips', 'tungau'];

/** Total hujan 3 hari yang dianggap kondisi lembap berkepanjangan, mm. */
const WET_TOTAL_MM = 30;

export function assessPestRisk(rain: { yesterday: number; today: number; tomorrow: number }): PestRiskAssessment {
  const total = rain.yesterday + rain.today + rain.tomorrow;

  if (total >= WET_TOTAL_MM) {
    return {
      condition: 'lembap',
      reason: `Curah hujan tinggi (${Math.round(total)} mm dalam 3 hari) — kondisi lembap mendukung jamur, busuk, dan siput.`,
      keywords: WET_KEYWORDS,
    };
  }
  if (total === 0) {
    return {
      condition: 'kering',
      reason: 'Tidak ada hujan sama sekali dalam 3 hari — kondisi kering dan hangat mendukung kutu daun dan tungau.',
      keywords: DRY_KEYWORDS,
    };
  }
  return { condition: null, reason: '', keywords: [] };
}

export interface RiskCandidate {
  plantingId: string;
  label: string;
  /** Hama umum tanaman ini dari katalog. */
  catalogPests: string[];
  /** Hama yang pernah dicatat pengguna sendiri untuk tanaman ini. */
  ownHistoryPests: string[];
}

export interface PestRiskWarning {
  plantingId: string;
  label: string;
  matchedPests: string[];
}

/**
 * Tanaman mana yang perlu diwaspadai untuk kondisi cuaca saat ini.
 *
 * Riwayat hama pengguna sendiri ikut disilangkan, bukan hanya daftar umum
 * katalog — kalau tanaman ini pernah kena kutu daun sebelumnya, itu sinyal
 * lebih kuat daripada sekadar "kutu daun ada di daftar katalog".
 */
export function findAtRiskPlantings(keywords: string[], candidates: RiskCandidate[]): PestRiskWarning[] {
  if (keywords.length === 0) return [];

  const warnings: PestRiskWarning[] = [];
  for (const candidate of candidates) {
    const allPests = [...new Set([...candidate.catalogPests, ...candidate.ownHistoryPests])];
    const matched = allPests.filter((pest) =>
      keywords.some((kw) => pest.toLowerCase().includes(kw))
    );
    if (matched.length > 0) {
      warnings.push({ plantingId: candidate.plantingId, label: candidate.label, matchedPests: matched });
    }
  }
  return warnings;
}
