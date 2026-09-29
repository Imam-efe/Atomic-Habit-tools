/**
 * Uji `advanceDate`.
 *
 * Fungsi ini sudah dipakai mesin transaksi berulang di index.ts sejak lama
 * tanpa satu pun uji, dan sekarang tagihan terjadwal ikut berdiri di atasnya.
 * Dua kelas kesalahan yang dijaga di sini, keduanya tetap mengembalikan
 * tanggal yang tampak wajar:
 *
 * 1. Akhir bulan. 31 Januari + 1 bulan harus jadi 28/29 Februari. Tanpa
 *    penjepitan, `setMonth` melimpah ke 3 Maret — dan tagihan Februari hilang.
 *
 * 2. Zona waktu. Fungsi ini membangun `Date` dengan konstruktor WAKTU LOKAL
 *    lalu membacanya kembali dengan pembaca lokal. Campuran lokal/UTC semacam
 *    itu pernah kebobolan di repo ini (lihat catatan `shiftDate` di daily.ts
 *    dan `triggerExpiryAlerts` di index.ts), jadi di sini pasangannya dibuktikan
 *    konsisten — termasuk di zona ber-offset setengah jam dan pada hari
 *    peralihan DST, yang tidak tersentuh oleh dua zona yang dipakai CI.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { advanceDate } from './validate';

const TZ_ASLI = process.env.TZ;
afterEach(() => { process.env.TZ = TZ_ASLI; });

describe('advanceDate', () => {
  it('maju sehari, sepekan, dan sebulan', () => {
    expect(advanceDate('2026-10-05', 'daily')).toBe('2026-10-06');
    expect(advanceDate('2026-10-05', 'weekly')).toBe('2026-10-12');
    expect(advanceDate('2026-10-05', 'monthly')).toBe('2026-11-05');
  });

  it('menjepit hari 31 ke akhir bulan yang lebih pendek', () => {
    expect(advanceDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceDate('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(advanceDate('2026-05-31', 'monthly')).toBe('2026-06-30');
    expect(advanceDate('2026-08-31', 'monthly')).toBe('2026-09-30');
  });

  it('menjepit ke 29 Februari pada tahun kabisat', () => {
    expect(advanceDate('2028-01-31', 'monthly')).toBe('2028-02-29');
  });

  it('melewati ganti tahun', () => {
    expect(advanceDate('2026-12-31', 'monthly')).toBe('2027-01-31');
    expect(advanceDate('2026-12-31', 'daily')).toBe('2027-01-01');
    expect(advanceDate('2026-12-28', 'weekly')).toBe('2027-01-04');
  });

  it('melewati 29 Februari pada langkah harian', () => {
    expect(advanceDate('2028-02-28', 'daily')).toBe('2028-02-29');
    expect(advanceDate('2028-02-29', 'daily')).toBe('2028-03-01');
    expect(advanceDate('2026-02-28', 'daily')).toBe('2026-03-01');
  });

  /**
   * Zona-zona ini dipilih karena masing-masing pernah jadi sumber bug tanggal
   * di aplikasi nyata: UTC+14 (hari kalender paling depan), UTC-7 dengan DST,
   * offset setengah jam (Lord Howe +10:30, Chatham +12:45), dan DST belahan
   * selatan. Dua di antaranya tidak tersentuh oleh zona yang dipakai CI.
   */
  const ZONA = [
    'UTC',
    'Asia/Jakarta',
    'Pacific/Kiritimati',
    'America/Los_Angeles',
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'America/Sao_Paulo',
  ];

  const KASUS: Array<[string, 'daily' | 'weekly' | 'monthly', string]> = [
    ['2026-01-31', 'monthly', '2026-02-28'],
    ['2028-01-31', 'monthly', '2028-02-29'],
    ['2026-12-31', 'monthly', '2027-01-31'],
    ['2026-12-31', 'daily', '2027-01-01'],
    ['2026-12-28', 'weekly', '2027-01-04'],
    // Hari peralihan DST: AS mulai, AS akhiri, Australia mulai.
    ['2026-03-08', 'daily', '2026-03-09'],
    ['2026-11-01', 'daily', '2026-11-02'],
    ['2026-10-04', 'daily', '2026-10-05'],
    ['2026-03-08', 'monthly', '2026-04-08'],
  ];

  for (const zona of ZONA) {
    it(`memberi hasil yang sama di ${zona}`, () => {
      process.env.TZ = zona;
      for (const [masuk, ulang, harap] of KASUS) {
        expect(advanceDate(masuk, ulang), `${masuk} ${ulang} di ${zona}`).toBe(harap);
      }
    });
  }
});
