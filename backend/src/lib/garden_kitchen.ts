/**
 * Dari kebun ke piring (#4).
 *
 * Panen sudah masuk stok Inventaris, lalu berhenti di situ. Pertanyaan yang
 * membuat orang bertahan berkebun tidak pernah dijawab: dari semua belanja
 * makanan bulan ini, berapa yang sebenarnya sudah bisa diambil dari halaman
 * sendiri.
 *
 * Angkanya dihitung dari harga jual yang dicatat pengguna di garden_plant_price
 * — nilai panen adalah uang yang tidak jadi keluar. Kalau harganya belum
 * dicatat, panen itu tetap dihitung jumlahnya tapi tidak dinilai rupiah, dan
 * itu dilaporkan apa adanya lewat `unpricedHarvests` daripada ditebak.
 */

export interface HarvestEntry {
  /**
   * Kunci harga, dipisah dari `name` dengan sengaja.
   *
   * Nama yang ditampilkan boleh julukan ("si merah"), sedangkan harga selalu
   * disimpan di bawah id katalog atau nama kustom. Menyatukan keduanya membuat
   * tanaman berjulukan kehilangan harganya diam-diam.
   */
  key: string;
  name: string;
  amount: number;
  unit: string;
  date: string;
}

/** Harga jual pasar per satuan, dari catatan pengguna. */
export type PriceMap = Map<string, number>;

export interface KitchenItem {
  name: string;
  amount: number;
  unit: string;
  /** null bila harga tanaman ini belum pernah dicatat. */
  valueIdr: number | null;
}

export interface KitchenReport {
  from: string;
  to: string;
  items: KitchenItem[];
  /** Total rupiah panen yang harganya diketahui. */
  harvestValueIdr: number;
  /** Belanja makanan pada periode yang sama. */
  foodSpendIdr: number;
  /**
   * Nilai panen dibanding belanja makanan, persen. null bila belum ada
   * belanja makanan tercatat — membagi dengan nol tidak menghasilkan wawasan.
   */
  selfSufficiencyPercent: number | null;
  /** Nama tanaman yang panennya belum bisa dinilai karena harga kosong. */
  unpricedHarvests: string[];
}

/**
 * Kunci harga: id katalog kalau ada, kalau tidak nama kustom ternormalisasi.
 *
 * Bentuknya harus persis sama dengan `plant_key` yang ditulis endpoint
 * /prices, kalau tidak harga yang sudah dicatat tidak akan pernah ketemu.
 */
export function priceKey(plantId: string | null, customName: string | null): string {
  return plantId ?? (customName ?? '').trim().toLowerCase();
}

export function buildKitchenReport(
  harvests: HarvestEntry[],
  prices: PriceMap,
  foodSpendIdr: number,
  from: string,
  to: string
): KitchenReport {
  // Digabung per tanaman DAN satuan: 2 kg dan 3 ikat bukan 5 apa pun.
  const grouped = new Map<string, KitchenItem & { key: string }>();

  for (const h of harvests) {
    if (!Number.isFinite(h.amount) || h.amount <= 0) continue;

    const groupKey = `${h.key}|${h.unit}`;
    const entry = grouped.get(groupKey) ?? {
      key: h.key, name: h.name, amount: 0, unit: h.unit, valueIdr: null,
    };
    entry.amount += h.amount;
    grouped.set(groupKey, entry);
  }

  const items: KitchenItem[] = [];
  const unpriced = new Set<string>();
  let totalValue = 0;

  for (const entry of grouped.values()) {
    const unitPrice = prices.get(entry.key);
    if (unitPrice !== undefined && unitPrice > 0) {
      const value = Math.round(entry.amount * unitPrice);
      totalValue += value;
      items.push({ name: entry.name, amount: entry.amount, unit: entry.unit, valueIdr: value });
    } else {
      unpriced.add(entry.name);
      items.push({ name: entry.name, amount: entry.amount, unit: entry.unit, valueIdr: null });
    }
  }

  // Yang bernilai paling besar didahulukan; yang belum berharga menyusul.
  items.sort((a, b) => (b.valueIdr ?? -1) - (a.valueIdr ?? -1));

  return {
    from,
    to,
    items,
    harvestValueIdr: totalValue,
    foodSpendIdr,
    selfSufficiencyPercent: foodSpendIdr > 0
      ? Math.round((totalValue / foodSpendIdr) * 100)
      : null,
    unpricedHarvests: [...unpriced],
  };
}
