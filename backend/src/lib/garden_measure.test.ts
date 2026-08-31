import { describe, it, expect } from 'vitest';
import { bersihkanUkuran, lajuTumbuh, MAX_HEIGHT_CM, MAX_LEAF } from './garden_measure';

describe('bersihkanUkuran', () => {
  it('menerima angka wajar', () => {
    expect(bersihkanUkuran(35.5, MAX_HEIGHT_CM)).toBe(35.5);
    expect(bersihkanUkuran('40', MAX_HEIGHT_CM)).toBe(40);
  });

  it('menolak negatif, nol, dan di luar batas', () => {
    // Tinggi 0 bukan pengukuran, itu bidang kosong yang terkirim.
    expect(bersihkanUkuran(0, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(-5, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(MAX_HEIGHT_CM, MAX_HEIGHT_CM)).toBe(MAX_HEIGHT_CM);
    expect(bersihkanUkuran(MAX_HEIGHT_CM + 1, MAX_HEIGHT_CM)).toBeNull();
  });

  it('menolak yang bukan angka', () => {
    expect(bersihkanUkuran(null, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(undefined, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran('tinggi', MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(NaN, MAX_HEIGHT_CM)).toBeNull();
    expect(bersihkanUkuran(Infinity, MAX_HEIGHT_CM)).toBeNull();
  });

  it('batas daun terpisah dari batas tinggi', () => {
    expect(bersihkanUkuran(1500, MAX_LEAF)).toBe(1500);
    expect(bersihkanUkuran(1500, MAX_HEIGHT_CM)).toBeNull();
  });
});

describe('lajuTumbuh', () => {
  it('menghitung cm per pekan dari dua titik', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);   // 14 cm / 2 pekan
    expect(l.mandek).toBe(false);
  });

  it('satu titik belum menghasilkan laju', () => {
    // Satu pengukuran bukan tren; melaporkannya sebagai laju adalah mengarang.
    const l = lajuTumbuh([{ measuredDate: '2026-08-01', heightCm: 10, leafCount: null }]);
    expect(l.cmPerPekan).toBeNull();
    expect(l.mandek).toBe(false);
  });

  it('kosong tidak melempar', () => {
    expect(lajuTumbuh([]).cmPerPekan).toBeNull();
  });

  it('tinggi yang tidak berubah dua pekan ditandai mandek', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 30, leafCount: null },
      { measuredDate: '2026-08-16', heightCm: 30, leafCount: null },
    ]);
    expect(l.mandek).toBe(true);
  });

  it('tinggi yang menyusut juga mandek', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 30, leafCount: null },
      { measuredDate: '2026-08-20', heightCm: 27, leafCount: null },
    ]);
    expect(l.mandek).toBe(true);
  });

  it('jeda kurang dari dua pekan belum disebut mandek', () => {
    // Tanaman memang tidak tumbuh terukur dalam tiga hari.
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 30, leafCount: null },
      { measuredDate: '2026-08-04', heightCm: 30, leafCount: null },
    ]);
    expect(l.mandek).toBe(false);
  });

  it('urutan tanggal acak tetap benar', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);
  });

  it('pengukuran tanpa tinggi dilewati, bukan dihitung nol', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-08', heightCm: null, leafCount: 12 },
      { measuredDate: '2026-08-15', heightCm: 24, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBe(7);
  });

  it('dua pengukuran di hari yang sama tidak membagi nol', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-01', heightCm: 12, leafCount: null },
    ]);
    expect(l.cmPerPekan).toBeNull();
  });

  it('melaporkan berapa pekan rentangnya', () => {
    const l = lajuTumbuh([
      { measuredDate: '2026-08-01', heightCm: 10, leafCount: null },
      { measuredDate: '2026-08-29', heightCm: 38, leafCount: null },
    ]);
    expect(l.pekan).toBe(4);
    expect(l.cmPerPekan).toBe(7);
  });
});
