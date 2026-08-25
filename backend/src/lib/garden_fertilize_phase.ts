/**
 * Pupuk mengikuti fase pertumbuhan (#15).
 *
 * Katalog menyimpan satu interval pupuk tetap per tanaman, tapi kebutuhan
 * haranya berubah sepanjang siklus: semai butuh dosis ringan supaya akar
 * muda tidak terbakar, vegetatif butuh nitrogen untuk daun dan batang,
 * berbunga/berbuah butuh fosfor dan kalium, bukan nitrogen lagi. Ini murni
 * aturan statis — tidak butuh AI, sama seperti computeCareState.
 */

export type GrowthPhase =
  | 'semai'
  | 'vegetatif'
  | 'generatif'
  | 'hias-daun'
  | 'hias-bunga'
  | 'sukulen';

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

/**
 * Fase pemupukan untuk tanaman hias.
 *
 * Tanaman hias tidak punya umur panen, jadi tidak punya rasio umur yang bisa
 * dipakai menentukan fase. Yang menggantikannya adalah untuk apa tanaman itu
 * ditanam: daun butuh nitrogen terus-menerus, bunga justru rusak oleh
 * nitrogen berlebih, dan sukulen lebih sering mati karena kelebihan pupuk
 * daripada kekurangan.
 */
export function ornamentalPhase(category: string): GrowthPhase {
  if (category === 'hias-bunga') return 'hias-bunga';
  if (category === 'sukulen') return 'sukulen';
  return 'hias-daun';
}

const PHASE_GUIDANCE: Record<GrowthPhase, string> = {
  semai:
    'Fase semai — dosis ringan saja (POC encer atau starter), akar muda masih rentan terbakar pupuk pekat.',
  vegetatif:
    'Fase vegetatif — utamakan pupuk tinggi nitrogen (N) untuk mendorong pertumbuhan daun dan batang.',
  generatif:
    'Fase berbunga/berbuah — kurangi nitrogen, tambah fosfor (P) dan kalium (K) supaya energinya ke bunga dan buah, bukan daun.',
  'hias-daun':
    'Hias daun — pupuk seimbang yang condong ke nitrogen (N), setengah dosis anjuran tapi lebih sering. Ujung daun cokelat biasanya kelebihan pupuk atau air keran berkapur, bukan kurang pupuk.',
  'hias-bunga':
    'Hias bunga — kurangi nitrogen menjelang musim berbunga dan tambah fosfor (P) serta kalium (K). Nitrogen berlebih menghasilkan daun rimbun tanpa satu kuntum pun.',
  sukulen:
    'Sukulen dan kaktus — pupuk paling sering sebulan sekali di musim tumbuh, seperempat dosis, dan berhenti saat musim hujan. Lebih banyak sukulen mati karena kelebihan air dan pupuk daripada kekurangan.',
};

export function fertilizeGuidance(phase: GrowthPhase): string {
  return PHASE_GUIDANCE[phase];
}
