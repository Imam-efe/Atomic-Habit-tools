/**
 * Kalender tanam musiman (#6).
 *
 * Katalog menyimpan `season` sebagai teks bebas, tapi kosakatanya kecil dan
 * konsisten — 'Awal musim hujan', 'Kemarau', 'Sepanjang tahun', dan beberapa
 * gabungan. Cukup dicocokkan kata kunci; tidak perlu AI untuk menebak sesuatu
 * yang sudah tertulis jelas.
 */

import type { Plant } from '../data/plants';

export type Season = 'hujan' | 'kemarau' | 'sepanjang-tahun';

/**
 * Musim Indonesia menurut bulan.
 *
 * Pembagian kasar yang dipakai penyuluh: hujan Oktober–Maret, kemarau
 * April–September. Nyatanya bergeser tiap tahun dan berbeda antar pulau, jadi
 * ini panduan waktu tanam, bukan ramalan cuaca — yang ramalan ada di
 * garden_weather.ts.
 *
 * @param month 1..12
 */
export function seasonOfMonth(month: number): Exclude<Season, 'sepanjang-tahun'> {
  return month >= 10 || month <= 3 ? 'hujan' : 'kemarau';
}

/** Musim yang cocok untuk sebuah tanaman, dari teks bebas di katalog. */
export function parseSeason(text: string): Season[] {
  const lower = text.toLowerCase();
  const seasons: Season[] = [];

  if (lower.includes('sepanjang tahun')) seasons.push('sepanjang-tahun');
  if (lower.includes('hujan')) seasons.push('hujan');
  if (lower.includes('kemarau')) seasons.push('kemarau');

  // Tidak ada kata kunci yang dikenal: perlakukan sebagai sepanjang tahun
  // daripada menyembunyikan tanamannya dari kalender selamanya.
  return seasons.length > 0 ? seasons : ['sepanjang-tahun'];
}

export interface PlantingWindow {
  plantId: string;
  name: string;
  emoji: string;
  season: string;
  /** 'ideal' bila musimnya persis cocok, 'bisa' bila sepanjang tahun. */
  fit: 'ideal' | 'bisa';
  daysToHarvest: [number, number];
  difficulty: string;
}

/**
 * Apa yang bagus ditanam pada bulan tertentu.
 *
 * Yang musimnya persis cocok didahulukan; yang sepanjang tahun tetap
 * disertakan tapi ditandai berbeda, karena "boleh kapan saja" bukan jawaban
 * yang sama dengan "sekarang waktunya".
 */
export function plantingCalendar(plants: Plant[], month: number): PlantingWindow[] {
  const current = seasonOfMonth(month);

  const windows: PlantingWindow[] = [];
  for (const plant of plants) {
    const seasons = parseSeason(plant.season);
    const exact = seasons.includes(current);
    const anytime = seasons.includes('sepanjang-tahun');
    if (!exact && !anytime) continue;

    windows.push({
      plantId: plant.id,
      name: plant.name,
      emoji: plant.emoji,
      season: plant.season,
      fit: exact ? 'ideal' : 'bisa',
      daysToHarvest: plant.daysToHarvest,
      difficulty: plant.difficulty,
    });
  }

  return windows.sort((a, b) => {
    if (a.fit !== b.fit) return a.fit === 'ideal' ? -1 : 1;
    // Yang cepat panen didahulukan: paling memuaskan untuk dimulai sekarang.
    return a.daysToHarvest[0] - b.daysToHarvest[0];
  });
}
