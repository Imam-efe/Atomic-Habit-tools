/**
 * Perencana ruang (#10).
 *
 * `spacingCm` dan `potLiter` sudah ada di katalog tapi cuma ditampilkan
 * sebagai angka mentah. Yang ditanyakan pekebun bukan "jaraknya berapa",
 * melainkan "lahan segini muat berapa" dan "pot segini cukup tidak".
 */

import type { Plant } from '../data/plants';

export interface BedFit {
  /** Jumlah tanaman yang muat pada luas itu. */
  count: number;
  /** Baris kali kolom untuk lahan persegi panjang, bila ukurannya diberi. */
  layout: { rows: number; cols: number } | null;
  spacingCm: number;
}

/**
 * Berapa tanaman muat di lahan seluas `areaM2`.
 *
 * Memakai luas per tanaman (jarak kuadrat), bukan penataan segitiga yang lebih
 * rapat. Penataan segitiga memuat ~15% lebih banyak, tapi hanya berlaku kalau
 * bedengannya benar-benar dipola begitu; angka yang terlalu optimistis
 * membuat orang membeli bibit lebih banyak daripada yang muat.
 */
export function fitInArea(plant: Plant, areaM2: number): BedFit {
  // Dihitung dalam sentimeter persegi, bukan meter. Dalam meter, jarak 10 cm
  // jadi 0,1 dan 0,1 x 0,1 = 0,010000000000000002 — pembagiannya menghasilkan
  // 99,99 lalu dibulatkan ke bawah jadi 99, kurang satu dari yang benar.
  const perPlantCm2 = plant.spacingCm * plant.spacingCm;
  const areaCm2 = Math.round(areaM2 * 10_000);

  return {
    count: perPlantCm2 > 0 ? Math.floor(areaCm2 / perPlantCm2) : 0,
    layout: null,
    spacingCm: plant.spacingCm,
  };
}

/** Berapa yang muat di bedengan `lengthM` kali `widthM`, beserta pola barisnya. */
export function fitInBed(plant: Plant, lengthM: number, widthM: number): BedFit {
  if (plant.spacingCm <= 0) return { count: 0, layout: null, spacingCm: plant.spacingCm };

  const cols = Math.floor(Math.round(lengthM * 100) / plant.spacingCm);
  const rows = Math.floor(Math.round(widthM * 100) / plant.spacingCm);

  return {
    count: Math.max(0, rows * cols),
    layout: { rows: Math.max(0, rows), cols: Math.max(0, cols) },
    spacingCm: plant.spacingCm,
  };
}

export interface PotVerdict {
  fits: boolean;
  neededLiter: number;
  /** Berapa tanaman muat dalam satu pot sebesar itu. */
  perPot: number;
  message: string;
}

/**
 * Apakah pot berukuran `potSizeLiter` cukup untuk tanaman ini.
 *
 * Katalog menyimpan volume minimum per tanaman, jadi pot yang lebih besar
 * bisa memuat lebih dari satu — tapi hanya kalau muatnya bulat, bukan
 * pembulatan ke atas yang membuat akar berebut.
 */
export function potFit(plant: Plant, potSizeLiter: number): PotVerdict {
  const needed = plant.potLiter;
  const perPot = needed > 0 ? Math.floor(potSizeLiter / needed) : 0;

  if (perPot < 1) {
    return {
      fits: false,
      neededLiter: needed,
      perPot: 0,
      message: `Pot ${potSizeLiter} liter kurang untuk ${plant.name} — minimal ${needed} liter.`,
    };
  }

  return {
    fits: true,
    neededLiter: needed,
    perPot,
    message:
      perPot === 1
        ? `Pot ${potSizeLiter} liter cukup untuk 1 ${plant.name}.`
        : `Pot ${potSizeLiter} liter muat ${perPot} ${plant.name}.`,
  };
}
