import { describe, it, expect } from 'vitest';
import { searchCuratedFoods, CURATED_FOODS } from './foods_id';

describe('searchCuratedFoods', () => {
  it('menemukan entri lewat nama penuh', () => {
    expect(searchCuratedFoods('nasi goreng').some((f) => f.id === 'nasi-goreng')).toBe(true);
  });

  it('menemukan entri lewat alias nama dagang umum', () => {
    expect(searchCuratedFoods('indomie').some((f) => f.id === 'mie-goreng-instan')).toBe(true);
  });

  it('mengembalikan array kosong untuk query kosong, bukan seluruh katalog', () => {
    expect(searchCuratedFoods('')).toEqual([]);
  });

  it('mengembalikan array kosong saat tidak ada yang cocok', () => {
    expect(searchCuratedFoods('xyz-tidak-ada-di-katalog')).toEqual([]);
  });
});

describe('CURATED_FOODS', () => {
  it('tidak punya id duplikat', () => {
    const ids = CURATED_FOODS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('punya angka gizi non-negatif di setiap entri', () => {
    for (const f of CURATED_FOODS) {
      const negatif = [f.calories, f.protein, f.carbs, f.fat, f.fiber, f.sodium, f.sugar].some(
        (n) => n < 0
      );
      expect(negatif, `angka negatif di ${f.id}`).toBe(false);
    }
  });
});
