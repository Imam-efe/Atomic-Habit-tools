/**
 * Perkiraan panen adaptif (#5).
 *
 * `expected_harvest_date` yang dipakai sekarang adalah angka mati dari katalog:
 * tanggal tanam + umur panen brosur. Padahal tanaman yang telat disiram dua
 * minggu tidak akan panen di hari yang sama dengan tanaman yang dirawat rapi.
 *
 * File ini menggeser perkiraan itu memakai dua hal yang sudah dicatat aplikasi:
 * kepatuhan perawatan (siram/pupuk) dan hari kering beruntun dari cuaca. Ini
 * bukan model pertumbuhan tanaman — ini koreksi jujur berbasis perilaku, dan
 * batasannya disebutkan lewat `confidence`.
 */

export interface CareCompliance {
  /** Berapa kali seharusnya disiram sampai hari ini, menurut interval katalog. */
  waterExpected: number;
  waterActual: number;
  fertilizeExpected: number;
  fertilizeActual: number;
}

export type ForecastConfidence = 'tinggi' | 'sedang' | 'rendah';

export interface HarvestForecast {
  /** Perkiraan katalog polos, tanpa koreksi. */
  baselineDate: string;
  /** Perkiraan setelah dikoreksi kepatuhan perawatan. */
  estimatedDate: string;
  /** Positif berarti mundur dari perkiraan katalog. */
  shiftDays: number;
  confidence: ForecastConfidence;
  /** Kalimat Indonesia yang menjelaskan kenapa bergeser. */
  reason: string;
  /** Hari terlewat dari perkiraan; 0 bila belum jatuh tempo. */
  overdueDays: number;
}

/**
 * Telat perawatan tidak menunda panen satu banding satu — tanaman memaafkan
 * sebagian. Faktor ini yang mengubah "persen kepatuhan yang hilang" jadi hari.
 * Nilainya konservatif: kepatuhan 50% pada tanaman berumur 60 hari menggeser
 * panen ~9 hari, bukan sebulan.
 */
const WATER_PENALTY_FACTOR = 0.3;
const FERTILIZE_PENALTY_FACTOR = 0.1;

/** Batas geser, supaya satu batch data aneh tidak melempar tanggal ke tahun depan. */
const MAX_SHIFT_RATIO = 0.5;

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

/** Rasio kepatuhan 0–1. Belum ada kewajiban sama sekali dianggap patuh penuh. */
function complianceRatio(expected: number, actual: number): number {
  if (!Number.isFinite(expected) || expected <= 0) return 1;
  return Math.max(0, Math.min(1, actual / expected));
}

export function forecastHarvest(
  plantedDate: string,
  daysToHarvestMin: number,
  care: CareCompliance,
  today: string,
  /** Tanggal panen manual dari pengguna menang atas hitungan katalog. */
  expectedHarvestDate?: string | null
): HarvestForecast {
  const baselineDate = expectedHarvestDate ?? addDays(plantedDate, daysToHarvestMin);
  const totalDays = Math.max(1, daysBetween(plantedDate, baselineDate));

  const waterRatio = complianceRatio(care.waterExpected, care.waterActual);
  const fertRatio = complianceRatio(care.fertilizeExpected, care.fertilizeActual);

  const rawShift =
    totalDays * (1 - waterRatio) * WATER_PENALTY_FACTOR +
    totalDays * (1 - fertRatio) * FERTILIZE_PENALTY_FACTOR;

  const maxShift = Math.round(totalDays * MAX_SHIFT_RATIO);
  const shiftDays = Math.min(maxShift, Math.round(rawShift));

  // Semakin banyak siklus perawatan yang sudah lewat, semakin banyak bukti.
  // Tanaman yang baru ditanam kemarin belum punya riwayat untuk dinilai.
  const evidence = care.waterExpected + care.fertilizeExpected;
  const confidence: ForecastConfidence = evidence >= 8 ? 'tinggi' : evidence >= 3 ? 'sedang' : 'rendah';

  let reason: string;
  if (shiftDays <= 0) {
    reason = evidence < 3
      ? 'Belum cukup riwayat perawatan untuk mengoreksi; masih memakai perkiraan katalog.'
      : 'Perawatan sesuai anjuran, panen diperkirakan tepat waktu.';
  } else {
    const parts: string[] = [];
    if (waterRatio < 1) {
      parts.push(`penyiraman baru ${care.waterActual} dari ${care.waterExpected} kali yang dianjurkan`);
    }
    if (fertRatio < 1) {
      parts.push(`pemupukan baru ${care.fertilizeActual} dari ${care.fertilizeExpected} kali`);
    }
    reason = `Perkiraan mundur ${shiftDays} hari karena ${parts.join(' dan ')}.`;
  }

  const estimatedDate = addDays(baselineDate, shiftDays);
  // Perkiraan yang sudah lewat tetap dilaporkan lewat, bukan digeser diam-diam
  // ke masa depan: tanaman yang belum panen padahal waktunya lewat justru yang
  // paling perlu dilihat pengguna.
  const overdueDays = Math.max(0, daysBetween(estimatedDate, today));

  return { baselineDate, estimatedDate, shiftDays, confidence, reason, overdueDays };
}

/**
 * Berapa kali seharusnya sudah dirawat sejak tanam sampai hari ini.
 *
 * Dipakai untuk membentuk `CareCompliance` dari data mentah. Dibatasi umur
 * tanaman, bukan tanggal panen, karena kewajiban perawatan berjalan sejak hari
 * pertama.
 */
export function expectedCareCount(plantedDate: string, today: string, intervalDays: number): number {
  if (!Number.isFinite(intervalDays) || intervalDays <= 0) return 0;
  const age = Math.max(0, daysBetween(plantedDate, today));
  return Math.floor(age / intervalDays);
}
