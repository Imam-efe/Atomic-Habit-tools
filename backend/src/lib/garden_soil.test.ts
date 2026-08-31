import { describe, it, expect } from 'vitest';
import {
  bersihkanPh, cocokPh, saranPerbaikan, cariSalahTanah, PH_MIN, PH_MAX,
} from './garden_soil';

describe('bersihkanPh', () => {
  it('menerima angka yang masuk akal', () => {
    expect(bersihkanPh(6.5)).toBe(6.5);
    expect(bersihkanPh('5.8')).toBe(5.8);
  });

  it('menolak yang di luar rentang alat ukur mana pun', () => {
    // pH 0 dan 14 ada di buku kimia, tidak ada di kebun. Angka seperti itu
    // hampir pasti salah ketik, dan menyimpannya akan melahirkan saran
    // pengapuran berkarung-karung untuk tanah yang sebenarnya normal.
    expect(bersihkanPh(0)).toBeNull();
    expect(bersihkanPh(14)).toBeNull();
    expect(bersihkanPh(PH_MIN)).toBe(PH_MIN);
    expect(bersihkanPh(PH_MAX)).toBe(PH_MAX);
  });

  it('menolak yang bukan angka', () => {
    expect(bersihkanPh(null)).toBeNull();
    expect(bersihkanPh('asam')).toBeNull();
    expect(bersihkanPh(NaN)).toBeNull();
    expect(bersihkanPh(Infinity)).toBeNull();
  });
});

describe('cocokPh', () => {
  it('di dalam rentang berarti cocok', () => {
    expect(cocokPh([5.5, 7.0], 6.2)).toBe('cocok');
  });

  it('batasnya masuk hitungan', () => {
    expect(cocokPh([5.5, 7.0], 5.5)).toBe('cocok');
    expect(cocokPh([5.5, 7.0], 7.0)).toBe('cocok');
  });

  it('di bawah rentang berarti terlalu masam', () => {
    expect(cocokPh([6.0, 7.0], 4.8)).toBe('terlalu-masam');
  });

  it('di atas rentang berarti terlalu basa', () => {
    expect(cocokPh([5.5, 6.5], 7.8)).toBe('terlalu-basa');
  });
});

describe('saranPerbaikan', () => {
  it('tanah masam disarankan dikapur', () => {
    const s = saranPerbaikan([6.0, 7.0], 4.8, 'liat');
    expect(s).toMatch(/dolomit|kapur/i);
  });

  it('dosis untuk tanah pasir lebih kecil daripada tanah liat', () => {
    // Tanah pasir punya daya sangga jauh lebih rendah; dosis yang sama akan
    // melampaui target dan membuat tanah terlalu basa.
    const pasir = saranPerbaikan([6.0, 7.0], 4.8, 'pasir') ?? '';
    const liat = saranPerbaikan([6.0, 7.0], 4.8, 'liat') ?? '';
    const angka = (s: string) => Number(s.match(/([\d.]+)\s*kg/)?.[1] ?? 0);
    expect(angka(pasir)).toBeGreaterThan(0);
    expect(angka(pasir)).toBeLessThan(angka(liat));
  });

  it('tanah basa disarankan bahan organik, dan justru dilarang dikapur', () => {
    const s = saranPerbaikan([5.5, 6.5], 7.8, 'lempung') ?? '';
    expect(s).toMatch(/kompos|organik|belerang/i);
    // Tidak boleh MENGANJURKAN kapur — mengapur tanah basa memperburuknya.
    expect(s).not.toMatch(/tabur dolomit/i);
    // Tapi larangannya harus disebut: dolomit adalah refleks pertama banyak
    // pekebun begitu tanahnya "bermasalah", tanpa memeriksa ke arah mana.
    expect(s).toMatch(/jangan dikapur/i);
  });

  it('tanah yang sudah cocok tidak diberi saran', () => {
    expect(saranPerbaikan([5.5, 7.0], 6.2, 'lempung')).toBeNull();
  });

  it('tekstur kosong tetap memberi saran, tanpa dosis mengarang', () => {
    const s = saranPerbaikan([6.0, 7.0], 4.8, null);
    expect(s).toBeTruthy();
    expect(s).not.toMatch(/\d+\s*kg/);
  });
});

describe('cariSalahTanah', () => {
  const uji = [
    { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 4.6, texture: 'liat', testedDate: '2026-08-01' },
    { lokasiId: 'loc:pot teras', lokasiLabel: 'Pot teras', ph: 6.3, texture: 'lempung', testedDate: '2026-08-02' },
  ];
  const phByPlant = new Map<string, [number, number]>([
    ['sawi-hijau', [6.0, 7.0]],
    ['kangkung', [5.5, 7.0]],
  ]);

  it('menandai tanaman di lokasi yang pH-nya di luar syaratnya', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p1', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-1' }],
      uji,
      phByPlant
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0].status).toBe('terlalu-masam');
    expect(hasil[0].saran).toBeTruthy();
  });

  it('tidak menandai yang pH-nya sudah pas', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p2', nama: 'Kangkung', plantId: 'kangkung', lokasiId: 'loc:pot teras' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('lokasi yang belum pernah diuji dilewati, bukan dianggap buruk', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p3', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-9' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('tanaman di luar katalog dilewati', () => {
    const hasil = cariSalahTanah(
      [{ plantingId: 'p4', nama: 'Entah', plantId: null, lokasiId: 'bed-1' }],
      uji,
      phByPlant
    );
    expect(hasil).toEqual([]);
  });

  it('memakai uji terbaru kalau satu lokasi diuji berkali-kali', () => {
    const berulang = [
      { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 4.6, texture: 'liat', testedDate: '2026-08-01' },
      { lokasiId: 'bed-1', lokasiLabel: 'Bedengan depan', ph: 6.4, texture: 'liat', testedDate: '2026-08-20' },
    ];
    const hasil = cariSalahTanah(
      [{ plantingId: 'p1', nama: 'Sawi', plantId: 'sawi-hijau', lokasiId: 'bed-1' }],
      berulang,
      phByPlant
    );
    // Sudah dikapur bulan lalu; peringatan lama tidak boleh terus muncul.
    expect(hasil).toEqual([]);
  });
});
