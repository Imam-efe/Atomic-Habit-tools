import { describe, it, expect, afterEach, vi } from 'vitest';
import { isNetworkError, isStaleChunkError } from './offlineQueue';
import { pesanGagal } from './pesanGagal';

/** navigator.onLine dipalsukan per kasus; dikembalikan lagi sesudahnya. */
function setOnline(nilai: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(nilai);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('isNetworkError', () => {
  it('TypeError biasa BUKAN masalah jaringan', () => {
    setOnline(true);
    // Ini yang membuat tombol "cetak lembar kerja" melapor "tidak ada
    // jaringan" di perangkat yang jelas online: galat pemrograman biasa
    // ikut tertangkap karena tipenya kebetulan TypeError.
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false);
  });

  it('kegagalan fetch sungguhan tetap dikenali di tiap peramban', () => {
    setOnline(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);          // Chrome
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true); // Firefox
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);              // Safari
  });

  it('offline sungguhan tetap benar apa pun galatnya', () => {
    setOnline(false);
    expect(isNetworkError(new Error('apa saja'))).toBe(true);
  });

  it('gagal muat chunk tidak diklaim sebagai masalah jaringan', () => {
    setOnline(true);
    const err = new TypeError('Failed to fetch dynamically imported module: https://x/assets/jspdf-abc123.js');
    // Pesannya memuat "failed to fetch", jadi urutan pemeriksaannya yang
    // menentukan — chunk basi harus menang, kalau tidak sarannya salah.
    expect(isStaleChunkError(err)).toBe(true);
    expect(isNetworkError(err)).toBe(false);
  });
});

describe('pesanGagal', () => {
  it('chunk basi menyuruh memuat ulang, bukan menunggu jaringan', () => {
    setOnline(true);
    const teks = pesanGagal('Gagal membuat lembar kerja', new TypeError('Failed to fetch dynamically imported module'));
    expect(teks).toContain('Muat ulang');
    expect(teks).not.toContain('tidak ada jaringan');
  });

  it('offline sungguhan tetap menyuruh menunggu jaringan', () => {
    setOnline(true);
    expect(pesanGagal('Gagal membuat lembar kerja', new TypeError('Failed to fetch')))
      .toContain('tidak ada jaringan');
  });

  it('galat lain tidak menyalahkan jaringan sama sekali', () => {
    setOnline(true);
    const teks = pesanGagal('Gagal membuat lembar kerja', new TypeError('undefined is not an object'));
    expect(teks).not.toContain('jaringan');
    expect(teks).not.toContain('Muat ulang');
  });
});
