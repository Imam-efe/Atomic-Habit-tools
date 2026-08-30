import { describe, it, expect } from 'vitest';
import {
  generasiBerikutnya, labelGenerasi, ringkasGalur, GENERASI_AWAL,
} from './garden_seed_lineage';

describe('generasiBerikutnya', () => {
  it('benih dari tanaman asal beli jadi generasi pertama', () => {
    expect(generasiBerikutnya(null)).toBe(GENERASI_AWAL);
  });

  it('bertambah satu tiap kali disimpan ulang dari keturunannya', () => {
    expect(generasiBerikutnya(1)).toBe(2);
    expect(generasiBerikutnya(4)).toBe(5);
  });

  it('nilai rusak tidak pernah menghasilkan generasi tak masuk akal', () => {
    expect(generasiBerikutnya(NaN)).toBe(GENERASI_AWAL);
    expect(generasiBerikutnya(-9)).toBe(GENERASI_AWAL);
    expect(generasiBerikutnya(2.7)).toBe(3);
  });
});

describe('labelGenerasi', () => {
  it('memberi label F yang dikenal pekebun', () => {
    expect(labelGenerasi(1)).toBe('F1');
    expect(labelGenerasi(3)).toBe('F3');
  });

  it('tidak pernah menampilkan F0 atau negatif', () => {
    expect(labelGenerasi(0)).toBe('F1');
    expect(labelGenerasi(-2)).toBe('F1');
  });
});

describe('ringkasGalur', () => {
  const benih = [
    { id: 's1', plantKey: 'tomat', label: 'Tomat', generation: 1, harvestedDate: '2025-01-01' },
    { id: 's2', plantKey: 'tomat', label: 'Tomat', generation: 2, harvestedDate: '2025-06-01' },
    { id: 's3', plantKey: 'bayam', label: 'Bayam', generation: 1, harvestedDate: '2025-03-01' },
  ];

  it('mengelompokkan per tanaman dan melaporkan generasi tertinggi', () => {
    const hasil = ringkasGalur(benih, []);
    const tomat = hasil.find((h) => h.plantKey === 'tomat')!;
    expect(tomat.generasiTertinggi).toBe(2);
    expect(tomat.jumlahBatch).toBe(2);
    expect(hasil.find((h) => h.plantKey === 'bayam')!.generasiTertinggi).toBe(1);
  });

  it('merata-ratakan panen per generasi', () => {
    const hasil = ringkasGalur(benih, [
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 2, unit: 'kg' },
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 4, unit: 'kg' },
      { savedSeedId: 's2', plantKey: 'tomat', generation: 2, totalPanen: 9, unit: 'kg' },
    ]);
    const tomat = hasil.find((h) => h.plantKey === 'tomat')!;
    expect(tomat.perGenerasi).toEqual([
      { generation: 1, jumlahDinilai: 2, rataPanen: 3, unit: 'kg' },
      { generation: 2, jumlahDinilai: 1, rataPanen: 9, unit: 'kg' },
    ]);
    expect(tomat.generasiTerbaik).toBe(2);
  });

  it('tidak menyebut generasi terbaik kalau baru satu generasi yang bisa dinilai', () => {
    // Satu generasi tidak bisa dibandingkan dengan apa pun; menyebutnya
    // "terbaik" akan terdengar seperti temuan padahal belum ada bandingannya.
    const hasil = ringkasGalur(benih, [
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 3, unit: 'kg' },
    ]);
    expect(hasil.find((h) => h.plantKey === 'tomat')!.generasiTerbaik).toBeNull();
  });

  it('tanaman yang belum dipanen tidak dihitung sebagai nol', () => {
    // Membedakan "belum panen" dari "gagal total" — kalau disamakan, galur
    // yang baru mulai akan terlihat lebih buruk daripada yang benar-benar gagal.
    const hasil = ringkasGalur(benih, [
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 4, unit: 'kg' },
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: null, unit: 'kg' },
    ]);
    const gen1 = hasil.find((h) => h.plantKey === 'tomat')!.perGenerasi[0];
    expect(gen1.jumlahDinilai).toBe(1);
    expect(gen1.rataPanen).toBe(4);
  });

  it('gagal total tetap dihitung, karena nol adalah jawaban sah', () => {
    const hasil = ringkasGalur(benih, [
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 4, unit: 'kg' },
      { savedSeedId: 's1', plantKey: 'tomat', generation: 1, totalPanen: 0, unit: 'kg' },
    ]);
    const gen1 = hasil.find((h) => h.plantKey === 'tomat')!.perGenerasi[0];
    expect(gen1.jumlahDinilai).toBe(2);
    expect(gen1.rataPanen).toBe(2);
  });

  it('daftar kosong menghasilkan ringkasan kosong, bukan galat', () => {
    expect(ringkasGalur([], [])).toEqual([]);
  });
});
