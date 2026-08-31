import { describe, it, expect } from 'vitest';
import { MANGSA, mangsaPada, musimMangsaKe } from './garden_mangsa';

describe('tabel MANGSA', () => {
  it('ada dua belas', () => {
    expect(MANGSA).toHaveLength(12);
  });

  it('urutannya 1..12 tanpa lompat', () => {
    expect(MANGSA.map((m) => m.urutan)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('jumlah harinya 365', () => {
    expect(MANGSA.reduce((n, m) => n + m.hari, 0)).toBe(365);
  });

  it('tiap mangsa punya pertanda dan saran', () => {
    for (const m of MANGSA) {
      expect(m.pertanda, m.nama).toBeTruthy();
      expect(m.saran, m.nama).toBeTruthy();
    }
  });
});

describe('mangsaPada', () => {
  it('22 Juni adalah awal Kasa', () => {
    expect(mangsaPada('2026-06-22').nama).toBe('Kasa');
  });

  it('1 Agustus masih Kasa, 2 Agustus sudah Karo', () => {
    expect(mangsaPada('2026-08-01').nama).toBe('Kasa');
    expect(mangsaPada('2026-08-02').nama).toBe('Karo');
  });

  it('mangsa yang melewati pergantian tahun tetap terbaca', () => {
    // Kapitu: 22 Desember – 2 Februari.
    expect(mangsaPada('2026-12-25').nama).toBe('Kapitu');
    expect(mangsaPada('2026-01-15').nama).toBe('Kapitu');
    expect(mangsaPada('2026-02-02').nama).toBe('Kapitu');
    expect(mangsaPada('2026-02-03').nama).toBe('Kawolu');
  });

  it('29 Februari tahun kabisat tidak jatuh ke celah', () => {
    // Kawolu berakhir 28 Februari di tahun biasa. Tanpa penanganan khusus,
    // 29 Februari tidak masuk mangsa mana pun.
    expect(mangsaPada('2024-02-29').nama).toBe('Kawolu');
  });

  it('tiap hari dalam setahun dapat tepat satu mangsa', () => {
    const d = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 365; i++) {
      const iso = d.toISOString().slice(0, 10);
      expect(() => mangsaPada(iso), iso).not.toThrow();
      d.setUTCDate(d.getUTCDate() + 1);
    }
  });

  it('musimnya sesuai pembagian empat', () => {
    expect(mangsaPada('2026-07-01').musim).toBe('ketiga');   // kemarau
    expect(mangsaPada('2026-10-01').musim).toBe('labuh');    // menjelang hujan
    expect(mangsaPada('2026-01-10').musim).toBe('rendheng'); // hujan
    expect(mangsaPada('2026-04-10').musim).toBe('mareng');   // menjelang kemarau
  });
});

describe('musimMangsaKe', () => {
  it('memetakan empat musim mangsa ke dua musim yang dipakai katalog', () => {
    expect(musimMangsaKe('rendheng')).toBe('hujan');
    expect(musimMangsaKe('labuh')).toBe('hujan');
    expect(musimMangsaKe('ketiga')).toBe('kemarau');
    expect(musimMangsaKe('mareng')).toBe('kemarau');
  });
});
