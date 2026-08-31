import { describe, it, expect } from 'vitest';
import { jadwalMundur, semaiTerlambat } from './garden_seedling_schedule';

describe('jadwalMundur', () => {
  it('menghitung mundur dari target tanam', () => {
    // Semai 3–4 minggu: pakai yang terlama supaya bibit tidak dipaksa pindah
    // sebelum siap. 28 hari sebelum 2026-10-01 adalah 2026-09-03.
    const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam');
    expect(j).not.toBeNull();
    expect(j!.mulaiSemai).toBe('2026-09-03');
    expect(j!.targetTanam).toBe('2026-10-01');
    expect(j!.pekan).toEqual([3, 4]);
  });

  it('menyisipkan adaptasi seminggu sebelum pindah', () => {
    // Bibit yang langsung dipindah dari tempat teduh ke matahari penuh
    // sering layu permanen. Seminggu penyesuaian mencegahnya.
    const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam');
    expect(j!.mulaiAdaptasi).toBe('2026-09-24');
  });

  it('null untuk tanaman yang ditanam benih langsung', () => {
    expect(jadwalMundur('2026-10-01', 'Tanam benih langsung')).toBeNull();
  });

  it('null untuk tanaman yang diperbanyak dengan stek', () => {
    expect(jadwalMundur('2026-10-01', 'Stek batang atau cangkok')).toBeNull();
  });

  it('melewati pergantian bulan dan tahun dengan benar', () => {
    const j = jadwalMundur('2026-01-05', 'Semai 4 minggu, pindah tanam');
    expect(j!.mulaiSemai).toBe('2025-12-08');
  });

  it('tanggalnya tidak bergeser oleh zona waktu perangkat', () => {
    // Perhitungan wajib memakai metode UTC. Kalau memakai metode lokal,
    // hasilnya bergeser sehari di zona waktu tertentu.
    const j = jadwalMundur('2026-03-30', 'Semai 2–3 minggu, pindah tanam');
    expect(j!.mulaiSemai).toBe('2026-03-09');
  });
});

describe('semaiTerlambat', () => {
  const j = jadwalMundur('2026-10-01', 'Semai 3–4 minggu, pindah tanam')!;

  it('nol kalau belum waktunya', () => {
    expect(semaiTerlambat(j, '2026-09-01')).toBe(0);
  });

  it('nol tepat pada hari mulai semai', () => {
    expect(semaiTerlambat(j, '2026-09-03')).toBe(0);
  });

  it('menghitung hari keterlambatan', () => {
    expect(semaiTerlambat(j, '2026-09-10')).toBe(7);
  });
});
