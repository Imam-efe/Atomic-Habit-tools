import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queueFor, newClientId, isNetworkError } from '../offlineQueue';
import { ApiError } from '../api';

const entry = (clientId: string, action = 'siram') => ({
  clientId,
  path: '/garden/p1/care',
  body: { action, date: '2026-01-01' } as Record<string, unknown>,
  queuedAt: 0,
});

const apiError = (status: number) => new ApiError('gagal', status, {});

let queue = queueFor('u1');

beforeEach(() => {
  localStorage.clear();
  queue = queueFor('u1');
});

describe('newClientId', () => {
  it('menghasilkan id yang diterima pola server', () => {
    // Server hanya menerima 8-64 karakter alfanumerik, tanda hubung, garis bawah.
    expect(newClientId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('tidak mengulang id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newClientId()));
    expect(ids.size).toBe(50);
  });
});

describe('isNetworkError', () => {
  it('mengenali kegagalan jaringan dari fetch', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('tidak menganggap penolakan server sebagai masalah jaringan', () => {
    expect(isNetworkError(apiError(400))).toBe(false);
  });
});

describe('enqueue', () => {
  it('menyimpan catatan yang gagal terkirim', () => {
    expect(queue.enqueue(entry('a1a1a1a1'))).toBe(true);
    expect(queue.size()).toBe(1);
  });

  it('tidak mengantre id yang sama dua kali', () => {
    // Pengguna menekan tombol berulang karena mengira tidak terjadi apa-apa.
    queue.enqueue(entry('a1a1a1a1'));
    expect(queue.enqueue(entry('a1a1a1a1'))).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it('tidak mengantre permintaan yang isinya sama meski id-nya baru', () => {
    // Offline, catat siram, tutup aplikasi. Dibuka lagi: layar memuat data
    // lama dari server, tanamannya terlihat belum disiram, pengguna mengetuk
    // lagi dengan clientId baru. Tanpa penjagaan ini tercatat siram dobel.
    queue.enqueue(entry('a1a1a1a1'));
    expect(queue.enqueue(entry('b2b2b2b2'))).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it('tetap mengantre permintaan yang isinya berbeda', () => {
    queue.enqueue(entry('a1a1a1a1', 'siram'));
    expect(queue.enqueue(entry('b2b2b2b2', 'pupuk'))).toBe(true);
    expect(queue.size()).toBe(2);
  });
});

describe('pemisahan antar akun', () => {
  it('tidak mencampur antrean dua akun', () => {
    // Antrean bersama akan mengirim catatan akun A dengan token akun B.
    const a = queueFor('u1');
    const b = queueFor('u2');
    a.enqueue(entry('a1a1a1a1'));

    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);
  });

  it('flush satu akun tidak mengirim catatan akun lain', async () => {
    const a = queueFor('u1');
    const b = queueFor('u2');
    a.enqueue(entry('a1a1a1a1'));
    b.enqueue(entry('b2b2b2b2', 'pupuk'));

    const send = vi.fn().mockResolvedValue({});
    await a.flush(send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('/garden/p1/care', expect.objectContaining({ clientId: 'a1a1a1a1' }));
    expect(b.size()).toBe(1);
  });
});

describe('antrean versi lama', () => {
  it('memindahkan catatan dari kunci bersama ke akun aktif', () => {
    // Versi sebelumnya sudah terpasang di ponsel pengguna; catatan yang
    // tertinggal di sana tidak boleh hilang begitu saja.
    localStorage.setItem('fayolla:offline-queue', JSON.stringify([entry('a1a1a1a1')]));

    const q = queueFor('u1');
    expect(q.size()).toBe(1);
    expect(localStorage.getItem('fayolla:offline-queue')).toBeNull();
  });

  it('tidak memindahkan dua kali', () => {
    localStorage.setItem('fayolla:offline-queue', JSON.stringify([entry('a1a1a1a1')]));

    queueFor('u1');
    const second = queueFor('u2');
    expect(second.size()).toBe(0);
  });
});

describe('flush', () => {
  it('mengosongkan antrean setelah semua terkirim', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    queue.enqueue(entry('b2b2b2b2', 'pupuk'));

    const send = vi.fn().mockResolvedValue({});
    const result = await queue.flush(send);

    expect(result).toEqual({ sent: 2, failed: 0, remaining: 0 });
    expect(queue.size()).toBe(0);
  });

  it('menyertakan clientId supaya server bisa menolak kiriman ulang', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockResolvedValue({});
    await queue.flush(send);

    expect(send).toHaveBeenCalledWith('/garden/p1/care', expect.objectContaining({
      clientId: 'a1a1a1a1',
      action: 'siram',
    }));
  });

  it('menahan antrean saat jaringan masih mati', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    queue.enqueue(entry('b2b2b2b2', 'pupuk'));

    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await queue.flush(send);

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(2);
    // Berhenti di kegagalan pertama, tidak menghabiskan baterai mencoba sisanya.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('membuang catatan yang ditolak permanen, bukan menyimpannya selamanya', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockRejectedValue(apiError(400));

    const result = await queue.flush(send);
    expect(result.failed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it.each([500, 503, 401, 429, 408])('menahan catatan saat server balas %i', async (status) => {
    // Deploy sedang berjalan atau token kedaluwarsa: keduanya sembuh sendiri
    // dalam hitungan menit. Membuang catatan panen di sini kehilangan data.
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockRejectedValue(apiError(status));

    const result = await queue.flush(send);
    expect(result.remaining).toBe(1);
  });

  it('menyerah setelah kegagalan sementara berulang', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockRejectedValue(apiError(500));

    // Satu entri yang selalu gagal tidak boleh menahan antrean selamanya,
    // karena flush berhenti di kegagalan pertama.
    for (let i = 0; i < 6; i++) await queue.flush(send);
    expect(queue.size()).toBe(0);
  });

  it('tidak menghabiskan jatah percobaan saat hanya offline', async () => {
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    for (let i = 0; i < 10; i++) await queue.flush(send);
    // Offline seminggu bukan salah catatannya.
    expect(queue.size()).toBe(1);
  });

  it('menyimpan sisa antrean saat jaringan putus di tengah', async () => {
    queue.enqueue(entry('a1a1a1a1', 'siram'));
    queue.enqueue(entry('b2b2b2b2', 'pupuk'));
    queue.enqueue(entry('c3c3c3c3', 'panen'));

    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await queue.flush(send);
    expect(result.sent).toBe(1);
    // Yang gagal dan yang belum sempat dicoba sama-sama dipertahankan.
    expect(result.remaining).toBe(2);
  });

  it('tidak menghapus catatan yang diantre selagi flush berjalan', async () => {
    queue.enqueue(entry('a1a1a1a1', 'siram'));

    const send = vi.fn().mockImplementation(async () => {
      // Pengguna mencatat perawatan lain sementara kiriman pertama menunggu.
      queue.enqueue(entry('c3c3c3c3', 'panen'));
    });

    const result = await queue.flush(send);
    expect(result.sent).toBe(1);
    expect(result.remaining).toBe(1);
    expect(queue.size()).toBe(1);
  });

  it('tidak melakukan apa-apa saat antrean kosong', async () => {
    const send = vi.fn();
    expect(await queue.flush(send)).toEqual({ sent: 0, failed: 0, remaining: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('tidak mengirim dobel saat dua flush berjalan bersamaan', async () => {
    // Layar memanggil flush saat dibuka DAN saat peristiwa `online`.
    queue.enqueue(entry('a1a1a1a1'));
    const send = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5)));

    const [first, second] = await Promise.all([queue.flush(send), queue.flush(send)]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(first.sent + second.sent).toBe(1);
  });
});

describe('clear', () => {
  it('mengosongkan antrean akun ini saja', () => {
    const a = queueFor('u1');
    const b = queueFor('u2');
    a.enqueue(entry('a1a1a1a1'));
    b.enqueue(entry('b2b2b2b2'));

    a.clear();
    expect(a.size()).toBe(0);
    expect(b.size()).toBe(1);
  });
});
