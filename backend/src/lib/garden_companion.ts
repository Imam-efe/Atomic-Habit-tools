/**
 * Tanam pendamping (#1).
 *
 * Katalog sudah menyimpan `companions` dan `avoid` sejak awal, tapi keduanya
 * belum pernah dipakai untuk apa pun. Isinya nama sehari-hari ('sawi',
 * 'bawang merah'), bukan id — jadi butuh resolusi ke katalog.
 */

import type { Plant } from '../data/plants';

export interface CompanionRef {
  /** Nama seperti tertulis di katalog. */
  term: string;
  /** Id katalog bila cocok; null kalau tanaman itu di luar katalog. */
  plantId: string | null;
  /** Nama tampilan: nama katalog kalau cocok, kalau tidak istilahnya sendiri. */
  label: string;
  /** True kalau tanaman ini sedang ditanam pengguna. */
  planted: boolean;
}

export interface CompanionAdvice {
  good: CompanionRef[];
  bad: CompanionRef[];
  /** Yang sedang ditanam dan sebaiknya dijauhkan — inilah yang harus ditindaklanjuti. */
  conflicts: CompanionRef[];
  /** Yang sedang ditanam dan cocok berdampingan. */
  matches: CompanionRef[];
}

/**
 * Cocokkan istilah katalog ke sebuah tanaman.
 *
 * Cocok persis dulu, baru awalan: katalog memuat 'sawi-hijau' sementara daftar
 * pendamping menulis 'sawi'. Tanpa aturan awalan, 13 dari 37 istilah akan
 * terbuang padahal tanamannya ada.
 */
export function resolveTerm(term: string, plants: Plant[]): Plant | null {
  const key = term.trim().toLowerCase();
  if (!key) return null;

  const exact = plants.find((p) => p.id === key);
  if (exact) return exact;

  const byPrefix = plants.find((p) => p.id.startsWith(`${key}-`));
  if (byPrefix) return byPrefix;

  return plants.find((p) => p.name.toLowerCase().startsWith(key)) ?? null;
}

function toRefs(terms: string[], plants: Plant[], plantedIds: Set<string>): CompanionRef[] {
  return terms.map((term) => {
    const match = resolveTerm(term, plants);
    return {
      term,
      plantId: match?.id ?? null,
      label: match?.name ?? term,
      planted: match !== null && plantedIds.has(match.id),
    };
  });
}

/**
 * Saran pendamping untuk satu tanaman, disilangkan dengan apa yang sedang
 * ditanam pengguna.
 *
 * @param plantedIds Id tanaman yang sedang tumbuh di kebun pengguna.
 */
export function companionAdvice(
  plant: Plant,
  plants: Plant[],
  plantedIds: Set<string>
): CompanionAdvice {
  const good = toRefs(plant.companions ?? [], plants, plantedIds);
  const bad = toRefs(plant.avoid ?? [], plants, plantedIds);

  return {
    good,
    bad,
    conflicts: bad.filter((r) => r.planted),
    matches: good.filter((r) => r.planted),
  };
}

export interface GardenConflict {
  plantId: string;
  plantName: string;
  withPlantId: string;
  withPlantName: string;
}

/**
 * Semua pasangan bertentangan di kebun saat ini.
 *
 * Dinormalkan supaya tomat-lawan-kentang dan kentang-lawan-tomat tidak
 * dilaporkan sebagai dua temuan berbeda — bagi pengguna itu satu masalah.
 */
export function findGardenConflicts(plantedPlants: Plant[], plants: Plant[]): GardenConflict[] {
  const plantedIds = new Set(plantedPlants.map((p) => p.id));
  const seen = new Set<string>();
  const conflicts: GardenConflict[] = [];

  for (const plant of plantedPlants) {
    for (const ref of toRefs(plant.avoid ?? [], plants, plantedIds)) {
      if (!ref.planted || !ref.plantId) continue;

      const pairKey = [plant.id, ref.plantId].sort().join('|');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      conflicts.push({
        plantId: plant.id,
        plantName: plant.name,
        withPlantId: ref.plantId,
        withPlantName: ref.label,
      });
    }
  }

  return conflicts;
}
