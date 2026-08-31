/**
 * Uji kalibrasi katalog dari riwayat sendiri.
 *
 * Yang diuji bukan angka hortikulturanya — itu tidak bisa dibuktikan oleh tes —
 * melainkan sifat yang harus berlaku: sampel yang terlalu sedikit tidak boleh
 * jadi koreksi, dan data mustahil tidak boleh ikut merata-rata.
 */

import { describe, it, expect } from 'vitest';
import { calibrateInterval } from './garden_calibration';

describe('calibrateInterval', () => {
  const g = (n: number) => ({ plantId: 'cabai-rawit', action: 'siram' as const, gapDays: n });

  it('null kalau sampelnya terlalu sedikit', () => {
    // Dua kali siram bukan kebiasaan.
    expect(calibrateInterval([g(3), g(3)], 2)).toBeNull();
  });

  it('menghitung interval nyata dari jarak antar-siram', () => {
    const c = calibrateInterval([g(3), g(3), g(4), g(3), g(3)], 2);
    expect(c!.intervalNyata).toBe(3);
    expect(c!.sampel).toBe(5);
    expect(c!.andal).toBe(true);
  });

  it('jarak yang mustahil dibuang, bukan ikut merata-rata', () => {
    // Jeda 60 hari berarti pengguna berlibur, bukan interval siramnya 60 hari.
    const c = calibrateInterval([g(3), g(3), g(3), g(3), g(60)], 2);
    expect(c!.intervalNyata).toBe(3);
    expect(c!.sampel).toBe(4);
  });

  it('jarak nol dibuang — dua catatan di hari sama bukan interval', () => {
    const c = calibrateInterval([g(0), g(3), g(3), g(3), g(3)], 2);
    expect(c!.intervalNyata).toBe(3);
    expect(c!.sampel).toBe(4);
  });

  it('daftar kosong tidak melempar', () => {
    expect(calibrateInterval([], 2)).toBeNull();
  });

  it('sisa sampel yang terlalu sedikit sesudah penyaringan tetap null', () => {
    expect(calibrateInterval([g(3), g(3), g(90), g(90), g(90)], 2)).toBeNull();
  });

  it('interval katalog yang besar melonggarkan batas buangnya', () => {
    // Pupuk tiap 30 hari: jeda 40 hari itu wajar, bukan anomali. Batas buang
    // harus mengikuti skala katalognya, bukan angka tetap.
    const p = (n: number) => ({ plantId: 'tomat', action: 'pupuk' as const, gapDays: n });
    const c = calibrateInterval([p(30), p(35), p(40), p(30), p(35)], 30);
    expect(c!.sampel).toBe(5);
    expect(c!.intervalNyata).toBe(34);
  });
});
