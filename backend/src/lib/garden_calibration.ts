/**
 * Kalibrasi katalog dari panen sendiri (#3 rilis ini).
 *
 * `daysToHarvest` di katalog adalah angka brosur: hasil uji di lahan yang
 * bukan lahan pengguna, dengan bibit, tanah, dan iklim yang bukan miliknya.
 * Begitu satu tanaman pernah ditanam sampai panen di kebun ini, ada angka yang
 * lebih layak dipercaya — umur panen yang benar-benar terjadi di sini.
 *
 * File ini mengubah riwayat itu jadi koreksi katalog. Bukan menggantikan
 * katalog: satu siklus panen bukan bukti, jadi koreksi hanya dipakai setelah
 * cukup siklus terkumpul, dan jumlahnya selalu dilaporkan.
 */

export interface HarvestCycle {
  plantId: string;
  plantedDate: string;
  /** Tanggal panen PERTAMA untuk penanaman itu, bukan panen terakhir. */
  firstHarvestDate: string;
}

export interface Calibration {
  plantId: string;
  /** Umur panen menurut katalog, hari. */
  catalogDays: number;
  /** Umur panen nyata rata-rata di kebun ini, hari. */
  actualDays: number;
  /** Positif berarti di kebun ini lebih lambat dari katalog. */
  deltaDays: number;
  cycles: number;
  /** Cukup siklus untuk dipakai mengoreksi perkiraan? */
  reliable: boolean;
}

/**
 * Satu siklus bisa kebetulan. Dua siklus sudah menunjukkan arah yang sama,
 * dan itu batas paling longgar yang masih jujur disebut pola.
 */
export const RELIABLE_MIN_CYCLES = 2;

/**
 * Batas kewajaran umur panen, hari.
 *
 * Panen yang tercatat sehari setelah tanam hampir pasti salah ketik tanggal,
 * dan satu baris seperti itu bisa menyeret rata-rata sampai tak berguna.
 * Batas atas menyaring penanaman yang dibiarkan lalu dipanen jauh belakangan.
 */
const MIN_SANE_DAYS = 5;
const MAX_SANE_DAYS = 400;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
  );
}

/**
 * Bandingkan umur panen nyata dengan katalog, per tanaman.
 *
 * `catalogDays` diambil dari peta yang diberikan pemanggil supaya file ini
 * tetap murni dan tidak perlu tahu bentuk katalog.
 */
export function calibrateFromHistory(
  cycles: HarvestCycle[],
  catalogDays: Map<string, number>
): Calibration[] {
  const byPlant = new Map<string, number[]>();

  for (const c of cycles) {
    const age = daysBetween(c.plantedDate, c.firstHarvestDate);
    if (age < MIN_SANE_DAYS || age > MAX_SANE_DAYS) continue;
    const list = byPlant.get(c.plantId) ?? [];
    list.push(age);
    byPlant.set(c.plantId, list);
  }

  const out: Calibration[] = [];
  for (const [plantId, ages] of byPlant.entries()) {
    const catalog = catalogDays.get(plantId);
    if (catalog === undefined || catalog <= 0) continue;

    const actual = Math.round(ages.reduce((s, a) => s + a, 0) / ages.length);
    out.push({
      plantId,
      catalogDays: catalog,
      actualDays: actual,
      deltaDays: actual - catalog,
      cycles: ages.length,
      reliable: ages.length >= RELIABLE_MIN_CYCLES,
    });
  }

  // Selisih terbesar didahulukan: itu yang paling mengubah perencanaan.
  return out.sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays));
}

/**
 * Umur panen yang sebaiknya dipakai untuk sebuah tanaman.
 *
 * Mengembalikan angka katalog apa adanya sampai kalibrasi cukup meyakinkan.
 * Ini titik sambung ke perkiraan panen adaptif: begitu kebun punya riwayat,
 * perkiraan berhenti berangkat dari brosur dan mulai berangkat dari kenyataan.
 */
export function effectiveDaysToHarvest(
  plantId: string,
  catalogDays: number,
  calibrations: Calibration[]
): { days: number; calibrated: boolean } {
  const match = calibrations.find((c) => c.plantId === plantId && c.reliable);
  return match
    ? { days: match.actualDays, calibrated: true }
    : { days: catalogDays, calibrated: false };
}

// ──────────────── KALIBRASI INTERVAL SIRAM & PUPUK ────────────────

export interface CareGap {
  plantId: string;
  action: 'siram' | 'pupuk';
  /** Jarak hari ke catatan perawatan sejenis sebelumnya. */
  gapDays: number;
}

export interface IntervalNyata {
  intervalNyata: number;
  sampel: number;
  andal: boolean;
}

/** Minimal jarak tersisa sesudah penyaringan sebelum angkanya layak dipakai. */
const MIN_GAP_SAMPEL = 4;

/**
 * Batas atas jarak yang masih dianggap "kebiasaan", sebagai kelipatan interval
 * katalog.
 *
 * Skalanya mengikuti katalog, bukan angka tetap: jeda 40 hari itu anomali
 * untuk siram tiap 2 hari, tapi wajar untuk pupuk tiap 30 hari. Batas tetap
 * akan membuang separuh data pupuk yang sah.
 */
const BATAS_KELIPATAN = 5;

/**
 * Interval siram atau pupuk yang BENAR-BENAR terjadi, dari jarak antar catatan.
 *
 * `waterIntervalDays` di katalog adalah anjuran; yang dikerjakan pengguna
 * adalah kenyataan. Kalau keduanya berbeda jauh dan tanamannya sehat, yang
 * pantas dikoreksi adalah anjurannya.
 *
 * Jeda panjang dibuang lebih dulu: pengguna yang pergi sepekan meninggalkan
 * satu jarak 9 hari di tengah kebiasaan 2 hari, dan satu angka seperti itu
 * cukup untuk menggeser rata-rata sampai anjurannya jadi berbahaya.
 */
export function calibrateInterval(gaps: CareGap[], katalog: number): IntervalNyata | null {
  const batas = Math.max(katalog * BATAS_KELIPATAN, katalog + 1);
  const bersih = gaps.map((g) => g.gapDays).filter((d) => d > 0 && d <= batas);

  if (bersih.length < MIN_GAP_SAMPEL) return null;

  const rata = bersih.reduce((a, b) => a + b, 0) / bersih.length;
  return {
    intervalNyata: Math.round(rata),
    sampel: bersih.length,
    andal: bersih.length >= MIN_GAP_SAMPEL,
  };
}
