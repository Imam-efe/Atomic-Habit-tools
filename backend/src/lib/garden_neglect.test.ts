import { describe, it, expect } from 'vitest';
import { cariTerlantar, AMBANG_TERLANTAR } from './garden_neglect';

const t = (over: Record<string, unknown> = {}) => ({
  plantingId: 'p1',
  nama: 'Cabai',
  lastCare: '2026-08-01' as string | null,
  plantedDate: '2026-07-01',
  ...over,
});

describe('cariTerlantar', () => {
  it('menandai yang melewati ambang', () => {
    const hasil = cariTerlantar([t({ lastCare: '2026-08-01' })], '2026-08-31');
    expect(hasil).toHaveLength(1);
    expect(hasil[0].hariDiam).toBe(30);
  });

  it('yang baru dirawat tidak ditandai', () => {
    expect(cariTerlantar([t({ lastCare: '2026-08-30' })], '2026-08-31')).toEqual([]);
  });

  it('tepat di ambang belum ditandai', () => {
    // Ambang adalah batas "lebih dari", bukan "sama dengan" — supaya tanaman
    // tidak berkedip masuk-keluar daftar pada hari perbatasan.
    expect(cariTerlantar([t({ lastCare: '2026-08-10' })], '2026-08-31', 21)).toEqual([]);
  });

  it('sehari melewati ambang sudah ditandai', () => {
    expect(cariTerlantar([t({ lastCare: '2026-08-09' })], '2026-08-31', 21)).toHaveLength(1);
  });

  it('belum pernah dirawat dihitung dari tanggal tanam', () => {
    // Tanpa ini, tanaman yang tidak pernah disentuh sejak ditanam justru lolos
    // dari deteksi — padahal itu kasus yang paling parah.
    const hasil = cariTerlantar([t({ lastCare: null, plantedDate: '2026-07-01' })], '2026-08-31');
    expect(hasil).toHaveLength(1);
    expect(hasil[0].hariDiam).toBe(61);
  });

  it('yang baru ditanam dan belum dirawat tidak langsung ditandai', () => {
    expect(cariTerlantar([t({ lastCare: null, plantedDate: '2026-08-25' })], '2026-08-31')).toEqual([]);
  });

  it('diurutkan dari yang paling lama diam', () => {
    const hasil = cariTerlantar([
      t({ plantingId: 'a', lastCare: '2026-08-05' }),
      t({ plantingId: 'b', lastCare: '2026-07-01' }),
    ], '2026-08-31');
    expect(hasil.map((h) => h.plantingId)).toEqual(['b', 'a']);
  });

  it('daftar kosong tidak melempar', () => {
    expect(cariTerlantar([], '2026-08-31')).toEqual([]);
  });

  it('ambang bawaannya 21 hari', () => {
    expect(AMBANG_TERLANTAR).toBe(21);
  });
});
