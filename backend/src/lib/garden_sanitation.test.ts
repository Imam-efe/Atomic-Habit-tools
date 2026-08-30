import { describe, it, expect } from 'vitest';
import { perluSanitasi, cariPerluSanitasi } from './garden_sanitation';

describe('perluSanitasi', () => {
  it('perlu kalau belum pernah dibersihkan sama sekali', () => {
    expect(perluSanitasi('2026-01-01', '2026-02-01', null)).toBe(true);
  });

  it('tidak perlu kalau dibersihkan di antara akhir lama dan mulai baru', () => {
    expect(perluSanitasi('2026-01-01', '2026-02-01', '2026-01-15')).toBe(false);
  });

  it('perlu kalau pembersihan terakhir sebelum tanaman lama berakhir', () => {
    // Dibersihkan lalu ditanami lagi tanpa dibersihkan setelah tanaman itu berakhir.
    expect(perluSanitasi('2026-01-01', '2026-02-01', '2025-12-01')).toBe(true);
  });

  it('perlu kalau pembersihan tercatat setelah tanaman baru sudah mulai', () => {
    // Itu bukan pembersihan SEBELUM tanam, jadi tidak menghitung.
    expect(perluSanitasi('2026-01-01', '2026-02-01', '2026-02-15')).toBe(true);
  });

  it('tepat di batas tanggal dianggap valid', () => {
    expect(perluSanitasi('2026-01-01', '2026-02-01', '2026-01-01')).toBe(false);
    expect(perluSanitasi('2026-01-01', '2026-02-01', '2026-02-01')).toBe(false);
  });
});

describe('cariPerluSanitasi', () => {
  it('hanya mengembalikan lokasi yang benar-benar butuh peringatan', () => {
    const hasil = cariPerluSanitasi(
      [
        { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', prevEndDate: '2026-01-01', newStartDate: '2026-02-01' },
        { lokasiId: 'bed-2', lokasiLabel: 'Bedengan B', prevEndDate: '2026-01-01', newStartDate: '2026-02-01' },
      ],
      new Map([['bed-2', '2026-01-15']])
    );

    expect(hasil.map((h) => h.lokasiId)).toEqual(['bed-1']);
  });

  // Regresi: layar merender `message`, tapi peringatan sempat tidak
  // membawanya sama sekali — kartunya tampil dengan baris penjelasan kosong.
  it('setiap peringatan membawa kalimat siap tampil', () => {
    const hasil = cariPerluSanitasi(
      [{ lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', prevEndDate: '2026-01-01', newStartDate: '2026-02-01' }],
      new Map()
    );

    expect(hasil).toHaveLength(1);
    expect(hasil[0].message).toContain('Bedengan A');
    expect(hasil[0].message).toContain('2026-01-01');
    expect(hasil[0].message).toContain('2026-02-01');
  });

  // Regresi: tiga tanaman berakhir di bedengan yang sama adalah SATU
  // pekerjaan membersihkan, bukan tiga kartu peringatan yang sama.
  it('satu peringatan per lokasi, memakai tanggal berakhir paling baru', () => {
    const hasil = cariPerluSanitasi(
      [
        { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', prevEndDate: '2026-01-01', newStartDate: '2026-03-01' },
        { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', prevEndDate: '2026-02-10', newStartDate: '2026-03-01' },
        { lokasiId: 'bed-1', lokasiLabel: 'Bedengan A', prevEndDate: '2026-01-20', newStartDate: '2026-03-01' },
      ],
      new Map()
    );

    expect(hasil).toHaveLength(1);
    expect(hasil[0].prevEndDate).toBe('2026-02-10');
  });
});
