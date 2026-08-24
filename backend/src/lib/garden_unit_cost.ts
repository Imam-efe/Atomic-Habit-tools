/**
 * Harga pokok produksi per satuan panen (#6 rilis ini).
 *
 * Break-even yang sudah ada menjawab "kebun ini balik modal atau belum" untuk
 * seluruh kebun sekaligus. Yang tidak dijawabnya: tanaman mana yang menanggung
 * ruginya. Bisa saja kebun untung karena cabai, sementara selada terus merugi
 * bertahun-tahun tanpa pernah ketahuan.
 *
 * Angka yang dihasilkan di sini menjawab satu pertanyaan praktis menjelang
 * musim tanam: tanaman ini masih layak ditanam sendiri, atau lebih murah
 * dibeli di pasar.
 */

export interface PlantCostEntry {
  plantKey: string;
  name: string;
  costIdr: number;
}

export interface PlantHarvestEntry {
  plantKey: string;
  name: string;
  amount: number;
  unit: string;
}

export type Verdict = 'untung' | 'rugi' | 'impas' | 'belum-cukup-data';

export interface UnitCost {
  plantKey: string;
  name: string;
  totalCostIdr: number;
  totalAmount: number;
  unit: string;
  /** Biaya per satuan panen. null bila belum ada panen sama sekali. */
  costPerUnitIdr: number | null;
  /** Harga pasar per satuan, dari catatan pengguna. */
  marketPriceIdr: number | null;
  /** Selisih per satuan; positif berarti lebih murah menanam sendiri. */
  savingPerUnitIdr: number | null;
  verdict: Verdict;
  advice: string;
}

/** Selisih di bawah ini dianggap impas — presisi rupiah di sini palsu. */
const BREAK_EVEN_TOLERANCE = 0.05;

export function computeUnitCosts(
  costs: PlantCostEntry[],
  harvests: PlantHarvestEntry[],
  prices: Map<string, number>
): UnitCost[] {
  const costByPlant = new Map<string, { name: string; total: number }>();
  for (const c of costs) {
    const e = costByPlant.get(c.plantKey) ?? { name: c.name, total: 0 };
    e.total += c.costIdr;
    costByPlant.set(c.plantKey, e);
  }

  // Satuan mayoritas yang menang — 2 kg dan 3 ikat tidak bisa dijumlahkan
  // jadi satu angka yang berarti.
  const harvestByPlant = new Map<string, { name: string; byUnit: Map<string, number> }>();
  for (const h of harvests) {
    if (!Number.isFinite(h.amount) || h.amount <= 0) continue;
    const e = harvestByPlant.get(h.plantKey) ?? { name: h.name, byUnit: new Map() };
    e.byUnit.set(h.unit, (e.byUnit.get(h.unit) ?? 0) + h.amount);
    harvestByPlant.set(h.plantKey, e);
  }

  const keys = new Set([...costByPlant.keys(), ...harvestByPlant.keys()]);
  const out: UnitCost[] = [];

  for (const key of keys) {
    const cost = costByPlant.get(key);
    const harvest = harvestByPlant.get(key);
    const name = cost?.name ?? harvest?.name ?? key;
    const totalCost = cost?.total ?? 0;

    let unit = '-';
    let totalAmount = 0;
    if (harvest && harvest.byUnit.size > 0) {
      [unit, totalAmount] = [...harvest.byUnit.entries()].sort((a, b) => b[1] - a[1])[0];
    }

    const costPerUnit = totalAmount > 0 && totalCost > 0
      ? Math.round(totalCost / totalAmount)
      : null;
    const market = prices.get(key) ?? null;

    let verdict: Verdict = 'belum-cukup-data';
    let saving: number | null = null;
    let advice: string;

    if (costPerUnit === null) {
      advice = totalCost > 0
        ? `Sudah keluar biaya ${Math.round(totalCost).toLocaleString('id-ID')} rupiah tapi belum ada panen tercatat.`
        : 'Belum ada biaya maupun panen yang tercatat untuk tanaman ini.';
    } else if (market === null || market <= 0) {
      advice = `Biaya produksi ${costPerUnit.toLocaleString('id-ID')} rupiah per ${unit}. Catat harga pasarnya supaya bisa dibandingkan.`;
    } else {
      saving = market - costPerUnit;
      const ratio = Math.abs(saving) / market;
      if (ratio <= BREAK_EVEN_TOLERANCE) {
        verdict = 'impas';
        advice = `Menanam sendiri dan membeli hampir sama mahal (${costPerUnit.toLocaleString('id-ID')} vs ${market.toLocaleString('id-ID')} per ${unit}).`;
      } else if (saving > 0) {
        verdict = 'untung';
        advice = `Hemat ${saving.toLocaleString('id-ID')} rupiah per ${unit} dibanding beli. Layak dilanjutkan.`;
      } else {
        verdict = 'rugi';
        advice = `Lebih mahal ${Math.abs(saving).toLocaleString('id-ID')} rupiah per ${unit} daripada membeli. Pertimbangkan mengurangi atau ganti tanaman.`;
      }
    }

    out.push({
      plantKey: key,
      name,
      totalCostIdr: Math.round(totalCost),
      totalAmount,
      unit,
      costPerUnitIdr: costPerUnit,
      marketPriceIdr: market,
      savingPerUnitIdr: saving,
      verdict,
      advice,
    });
  }

  // Yang paling merugi didahulukan — itu keputusan yang paling mendesak.
  const rank: Record<Verdict, number> = { rugi: 0, impas: 1, untung: 2, 'belum-cukup-data': 3 };
  return out.sort((a, b) => {
    if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
    return (a.savingPerUnitIdr ?? 0) - (b.savingPerUnitIdr ?? 0);
  });
}
