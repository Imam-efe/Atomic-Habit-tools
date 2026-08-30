import { describe, it, expect } from 'vitest';
import { ringkasAirHujan } from './garden_rainwater';

describe('ringkasAirHujan', () => {
  it('menjumlahkan tertampung dan terpakai', () => {
    const r = ringkasAirHujan(
      [
        { litersCollected: 50, litersUsed: 20 },
        { litersCollected: 30, litersUsed: 15 },
      ],
      0
    );
    expect(r.totalTertampung).toBe(80);
    expect(r.totalTerpakai).toBe(35);
    expect(r.sisaTampungan).toBe(45);
  });

  it('hemat rupiah null kalau tarif belum diisi', () => {
    const r = ringkasAirHujan([{ litersCollected: 10, litersUsed: 5 }], 0);
    expect(r.hematRupiah).toBeNull();
  });

  it('menghitung hemat rupiah dari tarif yang diisi', () => {
    const r = ringkasAirHujan([{ litersCollected: 10, litersUsed: 5 }], 200);
    expect(r.hematRupiah).toBe(1000);
  });

  it('tidak pernah negatif meski nilai masukan negatif', () => {
    const r = ringkasAirHujan([{ litersCollected: -5, litersUsed: -3 }], 100);
    expect(r.totalTertampung).toBe(0);
    expect(r.totalTerpakai).toBe(0);
    expect(r.sisaTampungan).toBe(0);
  });

  it('sisa tampungan tidak negatif walau terpakai melebihi tertampung', () => {
    const r = ringkasAirHujan([{ litersCollected: 10, litersUsed: 30 }], 0);
    expect(r.sisaTampungan).toBe(0);
  });
});
