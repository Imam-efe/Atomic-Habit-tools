import { describe, it, expect } from 'vitest';
import { predictYield } from './garden_yield';

describe('predictYield', () => {
  it('mengembalikan null tanpa riwayat panen sama sekali', () => {
    expect(predictYield('cabai-rawit', [])).toBeNull();
  });

  it('memprediksi dari satu-satunya data dengan keyakinan rendah', () => {
    const result = predictYield('cabai-rawit', [{ amount: 2, unit: 'kg', date: '2026-07-01' }]);
    expect(result).toEqual({
      plantId: 'cabai-rawit',
      predictedAmount: 2,
      unit: 'kg',
      confidence: 'rendah',
      sampleSize: 1,
      excludedByUnit: 0,
    });
  });

  it('menaikkan keyakinan seiring bertambahnya riwayat', () => {
    const three = [
      { amount: 1, unit: 'kg', date: '2026-01-01' },
      { amount: 2, unit: 'kg', date: '2026-02-01' },
      { amount: 3, unit: 'kg', date: '2026-03-01' },
    ];
    expect(predictYield('cabai-rawit', three)?.confidence).toBe('sedang');

    const six = [
      ...three,
      { amount: 2, unit: 'kg', date: '2026-04-01' },
      { amount: 2, unit: 'kg', date: '2026-05-01' },
      { amount: 2, unit: 'kg', date: '2026-06-01' },
    ];
    expect(predictYield('cabai-rawit', six)?.confidence).toBe('tinggi');
  });

  it('hanya merata-ratakan 5 panen paling baru', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      amount: i < 3 ? 100 : 2, // tiga data lama sengaja jauh berbeda
      unit: 'kg',
      date: `2026-0${(i % 9) + 1}-01`,
    }));
    // Rata-rata 5 terakhir semuanya bernilai 2 — data lama yang menyimpang tidak boleh ikut menarik angkanya.
    expect(predictYield('cabai-rawit', history)?.predictedAmount).toBe(2);
  });

  it('menyingkirkan sampel yang satuannya beda dari mayoritas', () => {
    const result = predictYield('cabai-rawit', [
      { amount: 2, unit: 'kg', date: '2026-01-01' },
      { amount: 3, unit: 'kg', date: '2026-02-01' },
      { amount: 5, unit: 'ikat', date: '2026-03-01' },
    ]);
    expect(result?.unit).toBe('kg');
    expect(result?.sampleSize).toBe(2);
    expect(result?.excludedByUnit).toBe(1);
    expect(result?.predictedAmount).toBe(2.5);
  });

  it('membulatkan ke satu desimal', () => {
    const result = predictYield('cabai-rawit', [
      { amount: 1, unit: 'kg', date: '2026-01-01' },
      { amount: 2, unit: 'kg', date: '2026-02-01' },
      { amount: 2, unit: 'kg', date: '2026-03-01' },
    ]);
    // (1+2+2)/3 = 1.666...
    expect(result?.predictedAmount).toBe(1.7);
  });
});
