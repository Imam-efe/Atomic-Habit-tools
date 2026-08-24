/**
 * Ekonomi kebun (#3).
 *
 * Menjawab pertanyaan yang selalu muncul: berkebun sendiri ini sebenarnya
 * hemat atau tidak. Biaya datang dari garden_costs, hasil dari log panen yang
 * sudah lama menyimpan `amount` dan `unit` tanpa pernah dipakai.
 */

export interface HarvestRow {
  plantingId: string;
  plantKey: string;
  amount: number;
  unit: string;
}

export interface CostRow {
  plantingId: string | null;
  kind: string;
  amount: number;
}

export interface PriceRow {
  plantKey: string;
  price: number;
  unit: string;
}

export interface PlantingEconomics {
  plantingId: string;
  label: string;
  cost: number;
  /** Total panen dalam satuan yang tercatat. */
  harvested: number;
  unit: string;
  /** Nilai panen; null kalau harga untuk tanaman ini belum diisi. */
  value: number | null;
  /** value dikurangi cost; null kalau nilainya belum bisa dihitung. */
  net: number | null;
  /** True kalau satuan panen tidak cocok dengan satuan harga. */
  unitMismatch: boolean;
}

export interface EconomicsSummary {
  perPlanting: PlantingEconomics[];
  totalCost: number;
  /** Hanya menjumlahkan penanaman yang harganya sudah diisi. */
  totalValue: number;
  totalNet: number;
  /** Biaya umum tanpa penanaman tertentu, tetap dihitung di total. */
  sharedCost: number;
  /** Penanaman yang belum bisa dinilai, supaya UI bisa meminta harganya. */
  missingPrices: string[];
}

/**
 * Gabungkan biaya, panen, dan harga jadi ringkasan per penanaman.
 *
 * Aturan yang menentukan bentuknya: **jangan pernah menebak harga.** Kalau
 * pengguna belum mengisi harga pasar untuk sebuah tanaman, nilainya
 * dikembalikan null dan penanaman itu masuk `missingPrices` — bukan dinilai
 * nol, yang akan membuat kebun terlihat rugi padahal datanya cuma belum ada.
 */
export function summarizeEconomics(
  labels: Map<string, { label: string; plantKey: string }>,
  costs: CostRow[],
  harvests: HarvestRow[],
  prices: PriceRow[]
): EconomicsSummary {
  const priceByKey = new Map(prices.map((p) => [p.plantKey, p]));

  const costByPlanting = new Map<string, number>();
  let sharedCost = 0;
  for (const cost of costs) {
    if (cost.plantingId === null) {
      sharedCost += cost.amount;
      continue;
    }
    costByPlanting.set(cost.plantingId, (costByPlanting.get(cost.plantingId) ?? 0) + cost.amount);
  }

  const harvestByPlanting = new Map<string, { amount: number; unit: string }>();
  for (const harvest of harvests) {
    const current = harvestByPlanting.get(harvest.plantingId);
    // Satuan pertama yang tercatat menang. Menjumlahkan kg dengan ikat tidak
    // bermakna, jadi ketidakcocokan ditandai, bukan dipaksa jadi satu angka.
    harvestByPlanting.set(harvest.plantingId, {
      amount: (current?.amount ?? 0) + harvest.amount,
      unit: current?.unit ?? harvest.unit,
    });
  }

  const perPlanting: PlantingEconomics[] = [];
  const missingPrices: string[] = [];
  let totalCost = sharedCost;
  let totalValue = 0;

  for (const [plantingId, meta] of labels.entries()) {
    const cost = costByPlanting.get(plantingId) ?? 0;
    const harvest = harvestByPlanting.get(plantingId);
    const price = priceByKey.get(meta.plantKey);

    const harvested = harvest?.amount ?? 0;
    const unit = harvest?.unit ?? (price?.unit ?? 'kg');
    const unitMismatch = harvest !== undefined && price !== undefined && harvest.unit !== price.unit;

    const value = price && !unitMismatch ? Math.round(harvested * price.price) : null;

    if (price === undefined && harvested > 0) missingPrices.push(meta.plantKey);

    totalCost += cost;
    if (value !== null) totalValue += value;

    perPlanting.push({
      plantingId,
      label: meta.label,
      cost,
      harvested,
      unit,
      value,
      net: value === null ? null : value - cost,
      unitMismatch,
    });
  }

  return {
    // Yang paling menguntungkan di atas; yang belum bisa dinilai di bawah.
    perPlanting: perPlanting.sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity)),
    totalCost,
    totalValue,
    totalNet: totalValue - totalCost,
    sharedCost,
    missingPrices: [...new Set(missingPrices)],
  };
}

/**
 * Break-even kebun tahunan (#18).
 *
 * "Untung tahun ini" saja tidak menjawab "kebun ini sudah balik modal atau
 * belum" — modal infrastruktur (pot, media awal) sering ditanam di tahun
 * pertama sementara hasilnya baru terasa tahun-tahun berikutnya. Ini
 * mengumulasikan net dari tahun ke tahun dan menandai persis tahun mana
 * kumulatifnya pertama kali tidak lagi negatif.
 */
export interface YearlyTotal {
  year: number;
  cost: number;
  value: number;
}

export interface YearlyBreakEven {
  year: number;
  cost: number;
  value: number;
  net: number;
  cumulativeNet: number;
}

export interface BreakEvenSummary {
  years: YearlyBreakEven[];
  /** Tahun pertama kumulatif net tidak lagi negatif; null kalau belum pernah. */
  breakEvenYear: number | null;
  cumulativeNet: number;
}

export function computeBreakEven(totals: YearlyTotal[]): BreakEvenSummary {
  const sorted = [...totals].sort((a, b) => a.year - b.year);

  let cumulative = 0;
  let breakEvenYear: number | null = null;
  const years: YearlyBreakEven[] = sorted.map((t) => {
    const net = t.value - t.cost;
    cumulative += net;
    if (breakEvenYear === null && cumulative >= 0) breakEvenYear = t.year;
    return { year: t.year, cost: t.cost, value: t.value, net, cumulativeNet: cumulative };
  });

  return { years, breakEvenYear, cumulativeNet: cumulative };
}
