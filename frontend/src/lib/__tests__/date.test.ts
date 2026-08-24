import { describe, it, expect, afterEach, vi } from 'vitest';
import { todayISO, daysAgoISO, toISO } from '../date';

afterEach(() => {
  vi.useRealTimers();
});

/** Bekukan jam ke satu titik UTC tertentu. */
function at(utc: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(utc));
}

describe('todayISO', () => {
  it('memberi tanggal WIB, bukan UTC, saat dini hari', () => {
    // 01:00 WIB tanggal 24 masih tanggal 23 menurut UTC. Ini jendela tujuh
    // jam setiap malam ketika catatan tersimpan bertanggal kemarin.
    at('2026-08-23T18:00:00Z');
    expect(todayISO()).toBe('2026-08-24');
  });

  it('tidak melompat maju di penghujung hari WIB', () => {
    // 23:59 WIB tanggal 24; UTC sudah 16:59 tanggal 24 — keduanya sama.
    at('2026-08-24T16:59:00Z');
    expect(todayISO()).toBe('2026-08-24');
  });

  it('berganti hari tepat pada tengah malam WIB', () => {
    at('2026-08-24T16:59:59Z');
    expect(todayISO()).toBe('2026-08-24');
    at('2026-08-24T17:00:00Z');
    expect(todayISO()).toBe('2026-08-25');
  });

  it('tidak terpengaruh zona waktu perangkat', () => {
    // Backend menyimpan tanggal dengan jakartaToday(). Kalau helper ini ikut
    // zona ponsel, pengguna yang sedang di luar negeri akan mengirim tanggal
    // yang tidak sama dengan yang dicatat server.
    //
    // Nilai yang diharapkan ditulis tetap, dan CI menjalankan seluruh uji
    // frontend sekali lagi dengan TZ yang jauh dari WIB: lulus di keduanya
    // berarti hasilnya memang tidak bergantung zona perangkat.
    at('2026-08-23T18:00:00Z');
    expect(todayISO()).toBe('2026-08-24');
  });
});

describe('daysAgoISO', () => {
  it('menghitung mundur dari tanggal WIB', () => {
    at('2026-08-23T18:00:00Z'); // 24 Agustus WIB
    expect(daysAgoISO(0)).toBe('2026-08-24');
    expect(daysAgoISO(1)).toBe('2026-08-23');
    expect(daysAgoISO(6)).toBe('2026-08-18');
  });

  it('menyeberangi pergantian bulan', () => {
    at('2026-08-31T18:00:00Z'); // 1 September WIB
    expect(daysAgoISO(1)).toBe('2026-08-31');
  });
});

describe('toISO', () => {
  it('memakai komponen lokal, bukan menggeser ke UTC', () => {
    // Deretan tanggal dibangun dengan setDate(); toISOString() akan menggeser
    // setiap sel mundur satu hari di GMT+7 dan membuat seluruh peta panas
    // menampilkan data hari sebelumnya.
    const d = new Date(2026, 7, 24);
    expect(toISO(d)).toBe('2026-08-24');
  });

  it('memberi nol di depan untuk bulan dan tanggal satu digit', () => {
    expect(toISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('mengikuti setDate yang menyeberangi bulan', () => {
    const d = new Date(2026, 7, 30);
    d.setDate(d.getDate() + 3);
    expect(toISO(d)).toBe('2026-09-02');
  });
});
