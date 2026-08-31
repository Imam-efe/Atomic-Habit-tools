import { describe, it, expect } from 'vitest';
import { parseMetode, pekanSemai, tingkatBerhasil, ringkasMetode } from './garden_propagation';
import { PLANTS } from '../data/plants';

describe('parseMetode', () => {
  it('membaca stek dan cangkok sekaligus', () => {
    expect(parseMetode('Stek batang atau cangkok')).toEqual(
      expect.arrayContaining(['stek', 'cangkok'])
    );
  });

  it('membedakan semai-pindah dari benih langsung', () => {
    expect(parseMetode('Semai 3–4 minggu, pindah tanam')).toContain('semai-pindah');
    expect(parseMetode('Tanam benih langsung, 2 biji per lubang')).toContain('benih-langsung');
    expect(parseMetode('Tanam benih langsung')).not.toContain('semai-pindah');
  });

  it('membaca rimpang, umbi, okulasi, anakan', () => {
    expect(parseMetode('Rimpang bertunas')).toContain('rimpang');
    expect(parseMetode('Umbi bibit bertunas')).toContain('umbi');
    expect(parseMetode('Bibit cangkok atau okulasi')).toContain('okulasi');
    expect(parseMetode('Anakan dari rumpun induk')).toContain('anakan');
  });

  it('stek daun tidak salah dibaca sebagai stek batang saja', () => {
    expect(parseMetode('Stek daun, keringkan luka sehari')).toContain('daun');
  });

  it('teks tak dikenal menghasilkan daftar kosong, bukan tebakan', () => {
    expect(parseMetode('')).toEqual([]);
    expect(parseMetode('Beli bibit di toko')).toEqual([]);
  });

  it('tidak ada entri katalog yang membuatnya melempar galat', () => {
    for (const p of PLANTS) {
      expect(() => parseMetode(p.propagation), p.id).not.toThrow();
    }
  });

  it('sebagian besar katalog terbaca metodenya', () => {
    // Bukan semua: beberapa entri memang ditulis sebagai kalimat bebas.
    // Yang dijaga adalah parser tidak diam-diam berhenti bekerja.
    const terbaca = PLANTS.filter((p) => parseMetode(p.propagation).length > 0);
    expect(terbaca.length).toBeGreaterThan(PLANTS.length * 0.7);
  });
});

describe('pekanSemai', () => {
  it('membaca rentang pekan', () => {
    expect(pekanSemai('Semai 3–4 minggu, pindah tanam')).toEqual([3, 4]);
  });

  it('membaca satu angka pekan sebagai rentang rapat', () => {
    expect(pekanSemai('Semai 4 minggu, pindah tanam')).toEqual([4, 4]);
  });

  it('membaca satuan hari menjadi pekan', () => {
    expect(pekanSemai('Semai 10 hari, pindah tanam')).toEqual([2, 2]);
  });

  it('null kalau tidak ada tahap semai', () => {
    expect(pekanSemai('Tanam benih langsung')).toBeNull();
    expect(pekanSemai('Stek batang atau cangkok')).toBeNull();
  });
});

describe('tingkatBerhasil', () => {
  it('menghitung persen', () => {
    expect(tingkatBerhasil(10, 7)).toBe(70);
  });

  it('nol berhasil adalah 0, bukan null', () => {
    // Batch yang gagal total justru data terpenting tentang metodenya.
    expect(tingkatBerhasil(10, 0)).toBe(0);
  });

  it('belum dihitung tetap null', () => {
    expect(tingkatBerhasil(10, null)).toBeNull();
  });

  it('data mustahil ditolak, tidak dipaksa jadi angka', () => {
    expect(tingkatBerhasil(0, 0)).toBeNull();
    expect(tingkatBerhasil(5, 9)).toBeNull();
  });
});

describe('ringkasMetode', () => {
  it('menggabungkan per metode dan mengurutkan dari yang paling berhasil', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 8 },
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 6 },
      { plantId: 'tin', nama: 'Tin', method: 'cangkok', countStarted: 4, countRooted: 1 },
    ]);
    expect(hasil[0].method).toBe('stek');
    expect(hasil[0].batch).toBe(2);
    expect(hasil[0].rate).toBe(70);
    expect(hasil[1].method).toBe('cangkok');
    expect(hasil[1].rate).toBe(25);
  });

  it('batch yang belum dihitung tidak ikut merusak rata-rata', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: 8 },
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: null },
    ]);
    expect(hasil[0].rate).toBe(80);
    expect(hasil[0].started).toBe(10);
  });

  it('metode yang semua batch-nya belum dihitung tidak ditampilkan', () => {
    const hasil = ringkasMetode([
      { plantId: 'tin', nama: 'Tin', method: 'stek', countStarted: 10, countRooted: null },
    ]);
    expect(hasil).toEqual([]);
  });
});
