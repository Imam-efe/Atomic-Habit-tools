/**
 * Pupuk mengikuti fase pertumbuhan (#15).
 *
 * Katalog menyimpan satu interval pupuk tetap per tanaman, tapi kebutuhan
 * haranya berubah sepanjang siklus: semai butuh dosis ringan supaya akar
 * muda tidak terbakar, vegetatif butuh nitrogen untuk daun dan batang,
 * berbunga/berbuah butuh fosfor dan kalium, bukan nitrogen lagi. Ini murni
 * aturan statis — tidak butuh AI, sama seperti computeCareState.
 */

export type GrowthPhase = 'semai' | 'vegetatif' | 'generatif';

/**
 * Tentukan fase dari umur relatif terhadap umur panen tercepat.
 *
 * Begitu pernah dipanen sekali, tanaman panen-berulang (cabai, tomat) tetap
 * dianggap generatif seterusnya — rasio umur/umur-panen sudah tidak relevan
 * lagi begitu produksi bunga/buahnya sudah berjalan.
 */
export function growthPhase(ageDays: number, daysToHarvestMin: number, hasHarvested: boolean): GrowthPhase {
  if (hasHarvested) return 'generatif';

  const ratio = daysToHarvestMin > 0 ? ageDays / daysToHarvestMin : 1;
  if (ratio < 0.3) return 'semai';
  if (ratio < 0.7) return 'vegetatif';
  return 'generatif';
}

const PHASE_GUIDANCE: Record<GrowthPhase, string> = {
  semai:
    'Fase semai — dosis ringan saja (POC encer atau starter), akar muda masih rentan terbakar pupuk pekat.',
  vegetatif:
    'Fase vegetatif — utamakan pupuk tinggi nitrogen (N) untuk mendorong pertumbuhan daun dan batang.',
  generatif:
    'Fase berbunga/berbuah — kurangi nitrogen, tambah fosfor (P) dan kalium (K) supaya energinya ke bunga dan buah, bukan daun.',
};

export function fertilizeGuidance(phase: GrowthPhase): string {
  return PHASE_GUIDANCE[phase];
}
