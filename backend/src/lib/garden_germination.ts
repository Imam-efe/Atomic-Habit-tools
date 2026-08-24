/**
 * Pembibitan dan daya kecambah (#6).
 *
 * Katalog memberi anjuran umum, tapi tidak tahu benih merek apa yang benar-benar
 * tumbuh di tangan pengguna ini. Yang bisa menjawab itu hanya selisih antara
 * "berapa disemai" dan "berapa jadi" pada batch-batch sebelumnya.
 *
 * Semua fungsi di sini murni: route yang mengambil barisnya, file ini yang
 * menilai.
 */

export interface SowingRecord {
  id: string;
  plantId: string | null;
  name: string;
  brand: string | null;
  sownDate: string;
  seedCount: number;
  /** null berarti belum dihitung — beda dari 0 yang berarti gagal total. */
  germinatedCount: number | null;
}

export interface SourceScore {
  /** Merek benih, atau 'Tanpa merek' bila tidak dicatat. */
  brand: string;
  batches: number;
  seedsSown: number;
  seedsGerminated: number;
  /** 0–100, dibulatkan. */
  ratePercent: number;
  /** Cukup data untuk dipercaya? Satu batch bukan bukti. */
  reliable: boolean;
}

export const NO_BRAND = 'Tanpa merek';

/** Batch dianggap layak dibandingkan setelah minimal sekian butir terkumpul. */
const RELIABLE_MIN_SEEDS = 20;
const RELIABLE_MIN_BATCHES = 2;

/** Persentase kecambah satu batch. `sown` 0 tidak bisa dibagi, jadi null. */
export function germinationRate(sown: number, germinated: number): number | null {
  if (!Number.isFinite(sown) || sown <= 0) return null;
  if (!Number.isFinite(germinated) || germinated < 0) return null;
  // Kecambah lebih banyak dari yang disemai tidak masuk akal; kunci di 100%
  // daripada melaporkan angka yang jelas salah ketik.
  return Math.round((Math.min(germinated, sown) / sown) * 100);
}

/**
 * Peringkat sumber benih dari riwayat sendiri.
 *
 * Batch yang belum dihitung (`germinatedCount === null`) diabaikan sepenuhnya:
 * memasukkannya sebagai nol akan menghukum benih yang sebenarnya belum sempat
 * dinilai, dan itu kesalahan yang paling mudah membuat peringkat ini menyesatkan.
 */
export function rankSeedSources(records: SowingRecord[]): SourceScore[] {
  const byBrand = new Map<string, { batches: number; sown: number; germinated: number }>();

  for (const r of records) {
    if (r.germinatedCount === null) continue;
    if (!Number.isFinite(r.seedCount) || r.seedCount <= 0) continue;

    const brand = r.brand?.trim() || NO_BRAND;
    const entry = byBrand.get(brand) ?? { batches: 0, sown: 0, germinated: 0 };
    entry.batches += 1;
    entry.sown += r.seedCount;
    entry.germinated += Math.min(r.germinatedCount, r.seedCount);
    byBrand.set(brand, entry);
  }

  const scores: SourceScore[] = [];
  for (const [brand, e] of byBrand.entries()) {
    scores.push({
      brand,
      batches: e.batches,
      seedsSown: e.sown,
      seedsGerminated: e.germinated,
      ratePercent: germinationRate(e.sown, e.germinated) ?? 0,
      reliable: e.batches >= RELIABLE_MIN_BATCHES && e.sown >= RELIABLE_MIN_SEEDS,
    });
  }

  // Yang datanya cukup didahulukan, baru diurut daya tumbuh. Merek dengan satu
  // batch beruntung tidak boleh menyalip merek yang terbukti puluhan kali.
  return scores.sort((a, b) => {
    if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
    if (b.ratePercent !== a.ratePercent) return b.ratePercent - a.ratePercent;
    return b.seedsSown - a.seedsSown;
  });
}

export interface SowingSummary {
  totalBatches: number;
  pendingCount: number;
  /** Rata-rata daya kecambah seluruh batch yang sudah dihitung, atau null. */
  overallRatePercent: number | null;
  /** Berapa bibit siap pindah tanam: sudah tumbuh, belum ditransplan. */
  readyToTransplant: number;
}

export interface SowingStatusRecord extends SowingRecord {
  transplantedDate: string | null;
}

export function summarizeSowings(records: SowingStatusRecord[]): SowingSummary {
  let sown = 0;
  let germinated = 0;
  let pending = 0;
  let ready = 0;

  for (const r of records) {
    if (r.germinatedCount === null) {
      pending++;
      continue;
    }
    sown += r.seedCount;
    germinated += Math.min(r.germinatedCount, r.seedCount);
    if (!r.transplantedDate) ready += Math.min(r.germinatedCount, r.seedCount);
  }

  return {
    totalBatches: records.length,
    pendingCount: pending,
    overallRatePercent: germinationRate(sown, germinated),
    readyToTransplant: ready,
  };
}
