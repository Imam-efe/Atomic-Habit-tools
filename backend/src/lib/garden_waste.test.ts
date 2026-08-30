import { describe, it, expect } from 'vitest';
import { statusPanen, laporanTerbuang } from './garden_waste';

describe('statusPanen', () => {
  it('terpakai begitu jumlahnya nol, apa pun tanggal kedaluwarsanya', () => {
    expect(statusPanen({ quantity: 0, expiryDate: '2020-01-01' }, '2026-01-01')).toBe('terpakai');
    expect(statusPanen({ quantity: 0, expiryDate: null }, '2026-01-01')).toBe('terpakai');
  });

  it('terbuang kalau kedaluwarsa dan masih ada sisa', () => {
    expect(statusPanen({ quantity: 2, expiryDate: '2025-12-01' }, '2026-01-01')).toBe('terbuang');
  });

  it('tidak pernah terbuang tanpa tanggal kedaluwarsa', () => {
    // Tanpa tanggal, aplikasi tidak punya dasar mengklaim itu basi.
    expect(statusPanen({ quantity: 2, expiryDate: null }, '2026-01-01')).toBe('masih-stok');
  });

  it('masih stok kalau belum kedaluwarsa', () => {
    expect(statusPanen({ quantity: 2, expiryDate: '2026-06-01' }, '2026-01-01')).toBe('masih-stok');
  });
});

describe('laporanTerbuang', () => {
  it('menjumlahkan tiap status dengan benar', () => {
    const r = laporanTerbuang(
      [
        { quantity: 0, expiryDate: null },
        { quantity: 2, expiryDate: '2025-01-01' },
        { quantity: 1, expiryDate: '2026-06-01' },
      ],
      '2026-01-01'
    );
    expect(r).toMatchObject({ totalItem: 3, terpakai: 1, terbuang: 1, masihStok: 1, wastePercent: 33 });
  });

  it('mengembalikan wastePercent null untuk daftar kosong, bukan NaN', () => {
    const r = laporanTerbuang([], '2026-01-01');
    expect(r.wastePercent).toBeNull();
    expect(r.totalItem).toBe(0);
  });
});
