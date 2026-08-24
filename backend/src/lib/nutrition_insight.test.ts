import { describe, it, expect } from 'vitest';
import { ALG_UMUM, computeAlgPercent, buildWarnings, scaleServing } from './nutrition_insight';

const EMPTY = {
  calories: 0,
  protein: 0,
  fat: 0,
  saturatedFat: 0,
  carbs: 0,
  sugar: 0,
  sodium: 0,
};

describe('computeAlgPercent', () => {
  it('menghitung separuh acuan kalori sebagai 50%', () => {
    const percent = computeAlgPercent({ ...EMPTY, calories: ALG_UMUM.calories / 2 });
    expect(percent.calories).toBe(50);
  });
});

describe('buildWarnings', () => {
  it('memicu warning saat natrium di atas ambang 20% ALG', () => {
    const high = computeAlgPercent({
      calories: 100,
      protein: 1,
      fat: 1,
      saturatedFat: 1,
      carbs: 10,
      sugar: 1,
      sodium: 500,
    });
    expect(buildWarnings(high).some((w) => w.includes('Natrium'))).toBe(true);
  });

  it('tidak memberi warning saat semua di bawah ambang', () => {
    const low = computeAlgPercent({
      calories: 100,
      protein: 1,
      fat: 1,
      saturatedFat: 1,
      carbs: 10,
      sugar: 1,
      sodium: 50,
    });
    expect(buildWarnings(low)).toEqual([]);
  });

  it('tidak memicu warning tepat di ambang 20% — batasnya >, bukan >=', () => {
    // 300/1500*100 = 20
    const atThreshold = computeAlgPercent({ ...EMPTY, sodium: 300 });
    expect(buildWarnings(atThreshold)).toEqual([]);
  });

  it('memicu warning sedikit di atas ambang (21%)', () => {
    // 315/1500*100 = 21
    const justOver = computeAlgPercent({ ...EMPTY, sodium: 315 });
    expect(buildWarnings(justOver).some((w) => w.includes('Natrium'))).toBe(true);
  });
});

describe('scaleServing', () => {
  it('mengalikan tiap field numerik', () => {
    expect(scaleServing({ calories: 100, protein: 2 }, 3)).toEqual({ calories: 300, protein: 6 });
  });

  it('mengembalikan null untuk servingsPerPack 0, bukan mengalikan dengan 0', () => {
    expect(scaleServing({ calories: 100 }, 0)).toBeNull();
  });

  it('mengembalikan null untuk servingsPerPack undefined', () => {
    expect(scaleServing({ calories: 100 }, undefined)).toBeNull();
  });
});
