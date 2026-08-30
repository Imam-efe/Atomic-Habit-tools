import { describe, it, expect } from 'vitest';
import { hitungSkorKesulitan, skorUntukTanaman } from './garden_difficulty';

describe('skorUntukTanaman', () => {
  it('null kalau percobaan masih di bawah ambang minimum', () => {
    expect(skorUntukTanaman(1, 0)).toBeNull();
    expect(skorUntukTanaman(1, 1)).toBeNull();
  });

  it('sulit kalau tingkat gagal setengah atau lebih', () => {
    expect(skorUntukTanaman(2, 1)).toBe('sulit');
    expect(skorUntukTanaman(4, 3)).toBe('sulit');
  });

  it('mudah kalau tingkat gagal seperlima atau kurang', () => {
    expect(skorUntukTanaman(10, 2)).toBe('mudah');
    expect(skorUntukTanaman(5, 0)).toBe('mudah');
  });

  it('sedang untuk yang di tengah', () => {
    expect(skorUntukTanaman(5, 2)).toBe('sedang');
  });
});

describe('hitungSkorKesulitan', () => {
  it('mengelompokkan riwayat per tanaman', () => {
    const hasil = hitungSkorKesulitan([
      { plantId: 'cabai', status: 'panen' },
      { plantId: 'cabai', status: 'gagal' },
      { plantId: 'cabai', status: 'panen' },
      { plantId: 'bayam', status: 'panen' },
    ]);

    const cabai = hasil.find((h) => h.plantId === 'cabai')!;
    expect(cabai.total).toBe(3);
    expect(cabai.gagal).toBe(1);
    expect(cabai.tingkatGagalPercent).toBe(33);

    const bayam = hasil.find((h) => h.plantId === 'bayam')!;
    expect(bayam.total).toBe(1);
    expect(bayam.skor).toBeNull();
  });

  it('daftar kosong menghasilkan hasil kosong', () => {
    expect(hitungSkorKesulitan([])).toEqual([]);
  });
});
