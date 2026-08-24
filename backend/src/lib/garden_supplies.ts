/**
 * Kalkulator kebutuhan media tanam dan pupuk (#7).
 *
 * Pekebun rumahan biasanya baru sadar kurang media saat tanah di karung habis
 * di tengah pindah tanam. Semua bahan hitungannya sudah ada di katalog —
 * volume pot, jarak tanam, interval pupuk — jadi kebutuhannya bisa
 * diberitahukan sebelum berangkat ke toko, bukan sesudah.
 *
 * Keluarannya sengaja berupa daftar belanja, bukan tabel agronomi: yang
 * dibutuhkan pengguna di kasir adalah "berapa karung", bukan "berapa liter per
 * meter persegi".
 */

export interface SupplyPlanting {
  plantingId: string;
  name: string;
  quantity: number;
  /** Volume pot minimum dari katalog, liter. 0 berarti tidak cocok di pot. */
  potLiter: number;
  /** Interval pupuk katalog, hari. */
  fertilizeIntervalDays: number;
  /** Sisa hari sampai perkiraan panen; 0 bila sudah lewat. */
  daysToHarvest: number;
}

export interface SupplyNeed {
  /** Kunci stabil untuk dipakai frontend sebagai React key. */
  id: string;
  label: string;
  /** Jumlah dalam satuan belanja, sudah dibulatkan ke atas. */
  amount: number;
  unit: string;
  /** Kenapa segini — supaya angkanya bisa diperiksa, bukan dipercaya buta. */
  basis: string;
}

/** Satu karung media tanam siap pakai di pasaran Indonesia. */
const SOIL_SACK_LITER = 25;

/**
 * Pupuk per aplikasi per tanaman, gram. Angka kasar untuk pupuk majemuk
 * granular di skala pekarangan — cukup untuk merencanakan belanja, bukan
 * untuk dosis presisi.
 */
const FERTILIZER_GRAM_PER_APPLICATION = 10;

/** Kemasan pupuk terkecil yang lazim dijual, gram. */
const FERTILIZER_PACK_GRAM = 1000;

/**
 * Berapa banyak yang perlu dibeli untuk seluruh tanaman aktif.
 *
 * Media tanam hanya dihitung untuk tanaman yang memang bisa di pot: menanam di
 * bedengan tidak butuh media beli.
 */
export function planSupplies(plantings: SupplyPlanting[]): SupplyNeed[] {
  let soilLiter = 0;
  let fertilizerGram = 0;

  for (const p of plantings) {
    const qty = Math.max(0, Math.floor(p.quantity));
    if (qty === 0) continue;

    if (p.potLiter > 0) soilLiter += p.potLiter * qty;

    if (p.fertilizeIntervalDays > 0 && p.daysToHarvest > 0) {
      const applications = Math.floor(p.daysToHarvest / p.fertilizeIntervalDays);
      fertilizerGram += applications * qty * FERTILIZER_GRAM_PER_APPLICATION;
    }
  }

  const needs: SupplyNeed[] = [];

  if (soilLiter > 0) {
    needs.push({
      id: 'media',
      label: 'Media tanam / tanah campur',
      amount: Math.ceil(soilLiter / SOIL_SACK_LITER),
      unit: 'karung 25 L',
      basis: `${Math.round(soilLiter)} liter untuk seluruh pot dan polybag`,
    });
  }

  if (fertilizerGram > 0) {
    needs.push({
      id: 'pupuk',
      label: 'Pupuk majemuk',
      amount: Math.ceil(fertilizerGram / FERTILIZER_PACK_GRAM),
      unit: 'kemasan 1 kg',
      basis: `${Math.round(fertilizerGram)} gram sampai semua tanaman panen`,
    });
  }

  return needs;
}
