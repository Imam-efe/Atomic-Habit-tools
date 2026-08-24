/**
 * Saran susun-tanam otomatis (#17).
 *
 * Perencana ruang (#10) hanya menjawab "muat berapa" untuk satu jenis
 * tanaman. Pertanyaan yang sebenarnya diajukan pekebun saat menata bedeng
 * baru adalah "tanaman-tanaman ini kalau ditanam bareng, cocok tidak" — itu
 * yang dijawab di sini, dengan menyilangkan kebutuhan luas gabungan dan data
 * pendamping (#1) yang sudah ada, bukan menebak tinggi tanaman yang memang
 * tidak tersimpan di katalog.
 */

import type { Plant } from '../data/plants';
import { resolveTerm } from './garden_companion';

export interface BedCandidate {
  plantId: string;
  quantity: number;
}

export interface LayoutPair {
  plantId: string;
  name: string;
  withPlantId: string;
  withName: string;
}

export interface LayoutSuggestion {
  /** Total luas yang dibutuhkan gabungan semua kandidat, m². */
  totalAreaNeededM2: number;
  /** Null kalau luas bedeng tidak diberikan. */
  fitsInBed: boolean | null;
  conflicts: LayoutPair[];
  goodPairs: LayoutPair[];
  /** Id tanaman yang bertentangan dengan salah satu kandidat lain — sebaiknya ditanam terpisah. */
  isolate: string[];
}

/**
 * Susun kandidat untuk satu bedeng: apakah luasnya cukup, dan pasangan mana
 * yang cocok atau sebaiknya dipisah.
 *
 * Tinggi tanaman sengaja tidak dipakai untuk urutan tanam utara-selatan —
 * katalog tidak menyimpan data itu, dan menebaknya dari kategori akan
 * memberi saran yang kelihatan pasti padahal cuma tebakan.
 */
export function planBedLayout(
  candidates: BedCandidate[],
  plants: Plant[],
  bedAreaM2: number | null
): LayoutSuggestion {
  const resolved = candidates
    .map((c) => ({ candidate: c, plant: plants.find((p) => p.id === c.plantId) }))
    .filter((r): r is { candidate: BedCandidate; plant: Plant } => !!r.plant);

  const totalAreaCm2 = resolved.reduce(
    (sum, r) => sum + r.plant.spacingCm * r.plant.spacingCm * Math.max(1, r.candidate.quantity),
    0
  );
  // Dihitung dalam sentimeter persegi lalu dikonversi terakhir — bukan
  // menjumlah meter persegi per tanaman, yang kena pembulatan pecahan sama
  // seperti masalah 0,1 x 0,1 pada fitInArea.
  const totalAreaNeededM2 = Math.round(totalAreaCm2) / 10_000;

  const conflicts: LayoutPair[] = [];
  const goodPairs: LayoutPair[] = [];
  const isolate = new Set<string>();

  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i].plant;
      const b = resolved[j].plant;

      const aAvoidsB = (a.avoid ?? []).some((term) => resolveTerm(term, plants)?.id === b.id);
      const bAvoidsA = (b.avoid ?? []).some((term) => resolveTerm(term, plants)?.id === a.id);
      if (aAvoidsB || bAvoidsA) {
        conflicts.push({ plantId: a.id, name: a.name, withPlantId: b.id, withName: b.name });
        isolate.add(a.id);
        isolate.add(b.id);
        continue;
      }

      const aLikesB = (a.companions ?? []).some((term) => resolveTerm(term, plants)?.id === b.id);
      const bLikesA = (b.companions ?? []).some((term) => resolveTerm(term, plants)?.id === a.id);
      if (aLikesB || bLikesA) {
        goodPairs.push({ plantId: a.id, name: a.name, withPlantId: b.id, withName: b.name });
      }
    }
  }

  return {
    totalAreaNeededM2,
    fitsInBed: bedAreaM2 === null ? null : totalAreaNeededM2 <= bedAreaM2,
    conflicts,
    goodPairs,
    isolate: [...isolate],
  };
}
