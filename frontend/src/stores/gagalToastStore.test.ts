import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGagalToastStore, tampilkanGagal } from './gagalToastStore';

beforeEach(() => {
  vi.useFakeTimers();
  useGagalToastStore.getState().tutup();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pesan = () => useGagalToastStore.getState().pesan;

describe('toast gagal simpan', () => {
  it('diam sampai ada yang gagal', () => {
    expect(pesan()).toBeNull();
  });

  it('menyebut aksi yang gagal, bukan cuma "terjadi kesalahan"', () => {
    tampilkanGagal('Gagal menyimpan goal', new Error('boom'));
    expect(pesan()).toContain('Gagal menyimpan goal');
  });

  it('mewarisi klasifikasi sebab, bukan menebak jaringan', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    tampilkanGagal('Gagal menyimpan goal', new TypeError('Failed to fetch'));
    expect(pesan()).toContain('tidak ada jaringan');

    tampilkanGagal('Gagal menyimpan goal', new TypeError('Failed to fetch dynamically imported module'));
    expect(pesan()).toContain('Muat ulang');

    // Galat pemrograman biasa tidak boleh menuduh jaringan — inilah yang dulu
    // membuat semua kegagalan terlihat seperti masalah sinyal.
    tampilkanGagal('Gagal menyimpan goal', new TypeError('undefined is not an object'));
    expect(pesan()).not.toContain('jaringan');
  });

  it('menghilang sendiri, tapi tidak sebelum sempat dibaca', () => {
    tampilkanGagal('Gagal menyimpan goal', new Error('boom'));
    vi.advanceTimersByTime(5000);
    expect(pesan()).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(pesan()).toBeNull();
  });

  it('kegagalan kedua menggantikan yang pertama dan memperpanjang waktunya', () => {
    tampilkanGagal('Gagal menyimpan goal', new Error('a'));
    vi.advanceTimersByTime(5000);
    tampilkanGagal('Gagal menyimpan project', new Error('b'));
    vi.advanceTimersByTime(5000);
    // Timer lama harus dibatalkan; kalau tidak, pesan kedua ikut terhapus
    // pada detik ke-6 milik pesan pertama.
    expect(pesan()).toContain('Gagal menyimpan project');
  });

  it('bisa ditutup manual', () => {
    tampilkanGagal('Gagal menyimpan goal', new Error('boom'));
    useGagalToastStore.getState().tutup();
    expect(pesan()).toBeNull();
  });
});
