import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatRupiah, jakartaHour } from './daily_push';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatRupiah', () => {
  it('meringkas jutaan dengan satu desimal koma', () => {
    expect(formatRupiah(1_500_000)).toBe('Rp1,5 jt');
    expect(formatRupiah(2_000_000)).toBe('Rp2 jt');
  });

  it('meringkas ribuan', () => {
    expect(formatRupiah(45_000)).toBe('Rp45 rb');
    expect(formatRupiah(400_000)).toBe('Rp400 rb');
  });

  it('menampilkan angka kecil apa adanya', () => {
    expect(formatRupiah(750)).toBe('Rp750');
  });

  it('memakai koma, bukan titik, untuk desimal', () => {
    // Titik adalah pemisah ribuan dalam penulisan Indonesia — memakainya
    // sebagai desimal membuat "Rp1.5 jt" terbaca seperti lima belas juta.
    expect(formatRupiah(1_250_000)).not.toContain('.');
  });
});

describe('jakartaHour', () => {
  it('menerjemahkan UTC ke UTC+7', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T01:30:00Z')); // 08:30 WIB
    expect(jakartaHour()).toBe(8);
  });

  it('menangani pergantian hari', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T23:30:00Z')); // 06:30 WIB tanggal 24
    expect(jakartaHour()).toBe(6);
  });
});
