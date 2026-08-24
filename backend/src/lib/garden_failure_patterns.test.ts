import { describe, it, expect } from 'vitest';
import { findFailurePatterns, type FailedPlanting } from './garden_failure_patterns';

const failure = (overrides: Partial<FailedPlanting> = {}): FailedPlanting => ({
  plantingId: 'p1',
  plantId: 'cabai-rawit',
  label: 'Cabai',
  location: 'Bedeng A',
  month: 3,
  hadPestIncident: false,
  ...overrides,
});

describe('findFailurePatterns', () => {
  it('tidak melaporkan kegagalan tunggal sebagai pola', () => {
    expect(findFailurePatterns([failure()])).toEqual([]);
  });

  it('mendeteksi lokasi yang sama pada mayoritas kegagalan', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', location: 'Bedeng A' }),
      failure({ plantingId: 'p2', location: 'Bedeng A' }),
      failure({ plantingId: 'p3', location: 'Bedeng B' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].commonLocation).toBe('Bedeng A');
    expect(result[0].hypotheses[0]).toMatch(/Bedeng A/);
  });

  it('tidak menandai lokasi kalau tersebar tanpa mayoritas', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', location: 'Bedeng A' }),
      failure({ plantingId: 'p2', location: 'Bedeng B' }),
    ]);
    expect(result[0].commonLocation).toBeNull();
  });

  it('mendeteksi bulan tanam yang sama', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', location: null, month: 12 }),
      failure({ plantingId: 'p2', location: null, month: 12 }),
    ]);
    expect(result[0].commonMonth).toBe(12);
    expect(result[0].hypotheses.some((h) => h.includes('Desember'))).toBe(true);
  });

  it('menghitung proporsi kegagalan yang disertai hama', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', location: null, hadPestIncident: true }),
      failure({ plantingId: 'p2', location: null, hadPestIncident: true }),
      failure({ plantingId: 'p3', location: null, hadPestIncident: false }),
    ]);
    expect(result[0].pestShare).toBeCloseTo(0.67, 2);
    expect(result[0].hypotheses.some((h) => h.includes('hama'))).toBe(true);
  });

  it('memberi hipotesis umum kalau tidak ada pola lokasi/musim/hama', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', location: 'Bedeng A', month: 1, hadPestIncident: false }),
      failure({ plantingId: 'p2', location: 'Bedeng B', month: 6, hadPestIncident: false }),
    ]);
    expect(result[0].commonLocation).toBeNull();
    expect(result[0].commonMonth).toBeNull();
    expect(result[0].hypotheses).toEqual([expect.stringMatching(/tanpa pola/)]);
  });

  it('mengurutkan dari yang paling sering gagal', () => {
    const result = findFailurePatterns([
      failure({ plantingId: 'p1', plantId: 'tomat', location: null }),
      failure({ plantingId: 'p2', plantId: 'tomat', location: null }),
      failure({ plantingId: 'p3', plantId: 'cabai-rawit', location: null }),
      failure({ plantingId: 'p4', plantId: 'cabai-rawit', location: null }),
      failure({ plantingId: 'p5', plantId: 'cabai-rawit', location: null }),
    ]);
    expect(result.map((r) => r.plantId)).toEqual(['cabai-rawit', 'tomat']);
  });
});
