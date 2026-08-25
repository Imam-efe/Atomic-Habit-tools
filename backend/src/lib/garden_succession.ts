/**
 * Tanam bergilir (#7).
 *
 * Untuk tanaman sekali cabut — kangkung, bayam, sawi — panen mengosongkan
 * bedengan sekaligus. Kalau batch berikutnya baru disemai setelah panen, ada
 * jeda selebar umur tanaman tanpa hasil apa pun. Menyemai lebih awal membuat
 * panennya bersambung.
 *
 * Tanaman panen berulang seperti cabai dan tomat tidak butuh ini: bedengannya
 * tidak pernah kosong sampai tanamannya benar-benar habis.
 */

import { dipanen, type Plant } from '../data/plants';
import { shiftDate, daysBetween } from './daily';

export interface SuccessionCandidate {
  plantingId: string;
  plantId: string;
  label: string;
  emoji: string;
  /** Perkiraan tanggal panen batch yang sedang tumbuh. */
  harvestDate: string;
  /** Kapan sebaiknya batch berikutnya disemai. */
  sowDate: string;
  /** Sisa hari sampai tanggal semai; negatif berarti sudah terlewat. */
  daysUntilSow: number;
}

/**
 * Jeda antara menyemai batch berikutnya dan panen batch sekarang.
 *
 * Setengah umur panen, dibatasi 7–21 hari. Terlalu awal berarti dua batch
 * berebut bedengan; terlalu mepet berarti tetap ada jeda kosong. Untuk
 * kangkung berumur 25 hari ini jatuh di 12 hari sebelum panen.
 */
export function sowLeadDays(daysToHarvest: number): number {
  return Math.min(21, Math.max(7, Math.round(daysToHarvest / 2)));
}

export interface ActivePlanting {
  id: string;
  plantId: string | null;
  label: string;
  /** Perkiraan panen berikutnya dari computeCareState. */
  nextHarvest: string | null;
}

/**
 * Penanaman yang sudah waktunya disemai ulang.
 *
 * @param withinDays Ambil yang tanggal semainya jatuh dalam sekian hari ke
 *                   depan. Yang sudah terlewat selalu ikut — terlambat menyemai
 *                   justru yang paling perlu diberitahu.
 */
export function findSuccessionDue(
  plantings: ActivePlanting[],
  plantsById: Map<string, Plant>,
  today: string,
  withinDays = 3
): SuccessionCandidate[] {
  const candidates: SuccessionCandidate[] = [];

  for (const planting of plantings) {
    if (!planting.plantId || !planting.nextHarvest) continue;

    const plant = plantsById.get(planting.plantId);
    // Hanya sekali cabut. Panen berulang tidak mengosongkan bedengan, dan
    // tanaman hias tidak pernah mengosongkannya sama sekali.
    if (!plant || plant.repeatHarvest || !dipanen(plant)) continue;

    const sowDate = shiftDate(planting.nextHarvest, -sowLeadDays(plant.daysToHarvest[0]));
    const daysUntilSow = daysBetween(today, sowDate);
    if (daysUntilSow > withinDays) continue;

    candidates.push({
      plantingId: planting.id,
      plantId: plant.id,
      label: planting.label,
      emoji: plant.emoji,
      harvestDate: planting.nextHarvest,
      sowDate,
      daysUntilSow,
    });
  }

  // Yang paling mendesak dulu, termasuk yang sudah terlewat.
  return candidates.sort((a, b) => a.daysUntilSow - b.daysUntilSow);
}
