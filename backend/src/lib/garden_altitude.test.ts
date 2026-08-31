import { describe, it, expect } from 'vitest';
import { parseAltitude, cocokKetinggian, BAND_MDPL } from './garden_altitude';
import { PLANTS } from '../data/plants';

describe('parseAltitude', () => {
  it('membaca satu band', () => {
    expect(parseAltitude('rendah')).toEqual([0, 400]);
    expect(parseAltitude('tinggi')).toEqual([700, 2000]);
  });

  it('membaca rentang "A sampai B"', () => {
    expect(parseAltitude('rendah sampai menengah')).toEqual([0, 700]);
    expect(parseAltitude('rendah sampai tinggi')).toEqual([0, 2000]);
    expect(parseAltitude('menengah sampai tinggi')).toEqual([400, 2000]);
  });

  it('teks tak dikenal jadi rentang terbuka, bukan kosong', () => {
    // Menyembunyikan tanaman karena teksnya tidak terbaca jauh lebih buruk
    // daripada tidak memberi peringatan apa pun.
    expect(parseAltitude('')).toEqual([0, 2000]);
    expect(parseAltitude('dataran pantai berangin')).toEqual([0, 2000]);
  });

  it('semua nilai altitude di katalog terbaca', () => {
    for (const p of PLANTS) {
      const [min, max] = parseAltitude(p.altitude);
      expect(max, p.id).toBeGreaterThan(min);
    }
  });
});

describe('cocokKetinggian', () => {
  it('di dalam rentang berarti cocok', () => {
    expect(cocokKetinggian('rendah sampai menengah', 300)).toBe('cocok');
  });

  it('kebun lebih tinggi dari batas atas tanaman', () => {
    expect(cocokKetinggian('rendah', 900)).toBe('terlalu-tinggi');
  });

  it('kebun lebih rendah dari batas bawah tanaman', () => {
    expect(cocokKetinggian('tinggi', 50)).toBe('terlalu-rendah');
  });

  it('batas dianggap masuk, bukan gagal', () => {
    expect(cocokKetinggian('rendah', 400)).toBe('cocok');
    expect(cocokKetinggian('tinggi', 700)).toBe('cocok');
  });

  it('mdpl 0 tetap dinilai, bukan dianggap "belum diisi"', () => {
    // 0 mdpl adalah jawaban sah untuk kebun di pesisir.
    expect(cocokKetinggian('tinggi', 0)).toBe('terlalu-rendah');
  });
});

describe('BAND_MDPL', () => {
  it('band-nya bersambung tanpa celah', () => {
    expect(BAND_MDPL.rendah[1]).toBe(BAND_MDPL.menengah[0]);
    expect(BAND_MDPL.menengah[1]).toBe(BAND_MDPL.tinggi[0]);
  });
});
