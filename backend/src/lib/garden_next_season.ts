/**
 * Rencana tanam musim depan (#7 rilis ini).
 *
 * Modul kebun sekarang punya banyak analisis yang benar tapi terpisah-pisah:
 * rotasi tahu apa yang tidak boleh ditanam di petak itu, kalender musim tahu
 * apa yang cocok bulan depan, pola gagal tahu apa yang selalu mati, HPP tahu
 * apa yang merugi, stok benih tahu apa yang sudah ada di laci.
 *
 * Semua itu laporan, bukan keputusan. File ini menggabungkannya jadi satu
 * daftar tindakan: musim depan, tanam ini, di sini, karena ini.
 *
 * Yang tidak dilakukan di sini sama pentingnya — tidak ada tanaman baru yang
 * dikarang. Kandidat hanya datang dari kalender musim, dan setiap alasan yang
 * ditempelkan berasal dari data pengguna sendiri.
 */

export interface SeasonCandidate {
  plantId: string;
  name: string;
  emoji: string;
  /** 'ideal' bila musimnya persis cocok, 'bisa' bila sepanjang tahun. */
  fit: 'ideal' | 'bisa';
  daysToHarvestMin: number;
}

export interface RotationBlock {
  /** Lokasi yang sedang dilarang untuk famili tanaman tertentu. */
  location: string;
  plantId: string;
  reason: string;
}

export interface SeedOnHand {
  plantId: string | null;
  name: string;
  /** Sudah lewat tanggal kedaluwarsa? Benih lama tetap dipakai, hanya diberi catatan. */
  expired: boolean;
}

export interface EconomicSignal {
  plantId: string;
  verdict: 'untung' | 'rugi' | 'impas' | 'belum-cukup-data';
  savingPerUnitIdr: number | null;
}

export interface FailureSignal {
  plantId: string;
  /** Berapa kali tanaman ini pernah gagal. */
  failures: number;
}

export type Recommendation = 'utamakan' | 'boleh' | 'hindari';

export interface SeasonPlanItem {
  plantId: string;
  name: string;
  emoji: string;
  recommendation: Recommendation;
  /** Alasan yang bisa diperiksa pengguna, bukan sekadar skor. */
  reasons: string[];
  /** Lokasi yang sedang terhalang rotasi, bila ada. */
  blockedLocations: string[];
  /** Benihnya sudah ada di laci? */
  seedOnHand: boolean;
  score: number;
}

/** Gagal berkali-kali layak jadi peringatan, bukan sekadar catatan kecil. */
const REPEATED_FAILURE_THRESHOLD = 2;

/**
 * Susun rencana musim depan.
 *
 * Skor hanya alat urut; yang dibaca pengguna adalah `reasons`. Sengaja
 * demikian — angka tunggal mudah dipercaya buta, daftar alasan bisa dibantah.
 */
export function planNextSeason(
  candidates: SeasonCandidate[],
  economics: EconomicSignal[],
  failures: FailureSignal[],
  seeds: SeedOnHand[],
  rotationBlocks: RotationBlock[]
): SeasonPlanItem[] {
  const econByPlant = new Map(economics.map((e) => [e.plantId, e]));
  const failByPlant = new Map(failures.map((f) => [f.plantId, f]));

  const seedPlantIds = new Set(seeds.filter((s) => s.plantId).map((s) => s.plantId!));
  const seedNames = new Set(seeds.map((s) => s.name.trim().toLowerCase()));

  const blocksByPlant = new Map<string, string[]>();
  for (const b of rotationBlocks) {
    const list = blocksByPlant.get(b.plantId) ?? [];
    list.push(b.location);
    blocksByPlant.set(b.plantId, list);
  }

  const items: SeasonPlanItem[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    let score = 0;

    if (c.fit === 'ideal') {
      reasons.push('Musimnya pas untuk ditanam sekarang.');
      score += 3;
    } else {
      reasons.push('Bisa ditanam kapan saja sepanjang tahun.');
      score += 1;
    }

    const econ = econByPlant.get(c.plantId);
    if (econ?.verdict === 'untung') {
      const hemat = econ.savingPerUnitIdr
        ? ` (hemat ${econ.savingPerUnitIdr.toLocaleString('id-ID')} rupiah per satuan)`
        : '';
      reasons.push(`Terbukti lebih murah ditanam sendiri${hemat}.`);
      score += 3;
    } else if (econ?.verdict === 'rugi') {
      reasons.push('Selama ini lebih mahal ditanam sendiri daripada dibeli.');
      score -= 3;
    }

    const fail = failByPlant.get(c.plantId);
    if (fail && fail.failures >= REPEATED_FAILURE_THRESHOLD) {
      reasons.push(`Sudah ${fail.failures} kali gagal di kebun ini.`);
      score -= 3;
    }

    const seedOnHand = seedPlantIds.has(c.plantId) || seedNames.has(c.name.trim().toLowerCase());
    if (seedOnHand) {
      reasons.push('Benihnya sudah ada di stok.');
      score += 2;
    }

    const blockedLocations = blocksByPlant.get(c.plantId) ?? [];
    if (blockedLocations.length > 0) {
      reasons.push(`Rotasi: hindari ${blockedLocations.join(', ')} untuk musim ini.`);
      score -= 1;
    }

    if (c.daysToHarvestMin <= 40) {
      reasons.push(`Cepat panen, sekitar ${c.daysToHarvestMin} hari.`);
      score += 1;
    }

    const recommendation: Recommendation =
      score >= 5 ? 'utamakan' : score <= 0 ? 'hindari' : 'boleh';

    items.push({
      plantId: c.plantId,
      name: c.name,
      emoji: c.emoji,
      recommendation,
      reasons,
      blockedLocations,
      seedOnHand,
      score,
    });
  }

  return items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
