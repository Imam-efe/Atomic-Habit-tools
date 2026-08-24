import { describe, it, expect } from 'vitest';
import { PLANTS } from '../data/plants';
import { planBedLayout } from './garden_layout';

describe('planBedLayout', () => {
  it('menghitung luas gabungan dari beberapa jenis tanaman berbeda spacing', () => {
    // tomat spacingCm 60, kentang spacingCm dicek lewat katalog langsung —
    // angka pastinya tidak dihardcode di sini supaya tidak lepas sinkron dari katalog.
    const tomat = PLANTS.find((p) => p.id === 'tomat')!;
    const kentang = PLANTS.find((p) => p.id === 'kentang')!;
    const expectedM2 =
      Math.round(tomat.spacingCm * tomat.spacingCm * 2 + kentang.spacingCm * kentang.spacingCm * 1) / 10_000;

    const result = planBedLayout(
      [
        { plantId: 'tomat', quantity: 2 },
        { plantId: 'kentang', quantity: 1 },
      ],
      PLANTS,
      null
    );
    expect(result.totalAreaNeededM2).toBeCloseTo(expectedM2, 4);
  });

  it('menandai muat kalau luas gabungan tidak melebihi luas bedeng', () => {
    const result = planBedLayout([{ plantId: 'bayam', quantity: 4 }], PLANTS, 10);
    expect(result.fitsInBed).toBe(true);
  });

  it('menandai tidak muat kalau luas gabungan melebihi luas bedeng', () => {
    const result = planBedLayout([{ plantId: 'jagung-manis', quantity: 100 }], PLANTS, 1);
    expect(result.fitsInBed).toBe(false);
  });

  it('fitsInBed null kalau luas bedeng tidak diberikan', () => {
    const result = planBedLayout([{ plantId: 'bayam', quantity: 1 }], PLANTS, null);
    expect(result.fitsInBed).toBeNull();
  });

  it('mendeteksi pasangan yang saling bertentangan (tomat menghindari kentang)', () => {
    const result = planBedLayout(
      [{ plantId: 'tomat', quantity: 1 }, { plantId: 'kentang', quantity: 1 }],
      PLANTS,
      null
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.isolate.sort()).toEqual(['kentang', 'tomat']);
  });

  it('mendeteksi pasangan yang saling cocok (tomat dengan kemangi)', () => {
    const result = planBedLayout(
      [{ plantId: 'tomat', quantity: 1 }, { plantId: 'kemangi', quantity: 1 }],
      PLANTS,
      null
    );
    expect(result.goodPairs).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
  });

  it('tidak melaporkan apa-apa untuk pasangan netral', () => {
    // Dua tanaman tanpa hubungan pendamping tercatat satu sama lain.
    const result = planBedLayout(
      [{ plantId: 'wortel', quantity: 1 }, { plantId: 'jahe', quantity: 1 }],
      PLANTS,
      null
    );
    expect(result.conflicts).toEqual([]);
    expect(result.goodPairs).toEqual([]);
    expect(result.isolate).toEqual([]);
  });

  it('mengabaikan id yang tidak ada di katalog tanpa error', () => {
    expect(() => planBedLayout([{ plantId: 'tidak-ada', quantity: 1 }], PLANTS, null)).not.toThrow();
    expect(planBedLayout([{ plantId: 'tidak-ada', quantity: 1 }], PLANTS, null).totalAreaNeededM2).toBe(0);
  });
});
