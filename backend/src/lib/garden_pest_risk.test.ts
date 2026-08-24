import { describe, it, expect } from 'vitest';
import { assessPestRisk, findAtRiskPlantings } from './garden_pest_risk';

describe('assessPestRisk', () => {
  it('menandai lembap saat total hujan 3 hari tinggi', () => {
    const result = assessPestRisk({ yesterday: 15, today: 10, tomorrow: 10 });
    expect(result.condition).toBe('lembap');
    expect(result.reason).toContain('35 mm');
    expect(result.keywords).toContain('jamur');
  });

  it('menandai kering saat tidak ada hujan sama sekali', () => {
    const result = assessPestRisk({ yesterday: 0, today: 0, tomorrow: 0 });
    expect(result.condition).toBe('kering');
    expect(result.keywords).toContain('kutu daun');
  });

  it('tidak menandai apa-apa untuk hujan sedang', () => {
    const result = assessPestRisk({ yesterday: 2, today: 3, tomorrow: 1 });
    expect(result.condition).toBeNull();
    expect(result.keywords).toEqual([]);
  });

  it('batas tepat 30 mm dihitung lembap', () => {
    expect(assessPestRisk({ yesterday: 10, today: 10, tomorrow: 10 }).condition).toBe('lembap');
  });
});

describe('findAtRiskPlantings', () => {
  it('mengembalikan kosong tanpa kata kunci', () => {
    expect(findAtRiskPlantings([], [
      { plantingId: 'p1', label: 'Bayam', catalogPests: ['kutu daun'], ownHistoryPests: [] },
    ])).toEqual([]);
  });

  it('mencocokkan hama katalog dengan kata kunci kondisi', () => {
    const result = findAtRiskPlantings(['kutu daun', 'tungau'], [
      { plantingId: 'p1', label: 'Bayam', catalogPests: ['kutu daun', 'karat putih'], ownHistoryPests: [] },
      { plantingId: 'p2', label: 'Wortel', catalogPests: ['ulat'], ownHistoryPests: [] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].plantingId).toBe('p1');
    expect(result[0].matchedPests).toEqual(['kutu daun']);
  });

  it('memprioritaskan riwayat hama sendiri, bukan cuma daftar katalog', () => {
    const result = findAtRiskPlantings(['jamur'], [
      { plantingId: 'p1', label: 'Tomat', catalogPests: [], ownHistoryPests: ['jamur daun'] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].matchedPests).toEqual(['jamur daun']);
  });

  it('tidak menduplikasi hama yang muncul di katalog maupun riwayat sendiri', () => {
    const result = findAtRiskPlantings(['kutu'], [
      { plantingId: 'p1', label: 'Cabai', catalogPests: ['kutu daun'], ownHistoryPests: ['kutu daun'] },
    ]);
    expect(result[0].matchedPests).toEqual(['kutu daun']);
  });
});
