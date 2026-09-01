/**
 * Uji sifat katalog, bukan kebenaran biologisnya.
 *
 * Interval cacingan dan umur ganti UVB tidak bisa dibuktikan lewat tes — sama
 * seperti umur panen di plants.test.ts. Yang bisa dan harus dijaga adalah
 * bentuknya: tidak ada id kembar, tidak ada hewan tanpa tugas, dan tidak ada
 * kolom keselamatan yang lupa diisi.
 */
import { describe, it, expect } from 'vitest';
import { ANIMALS, ANIMAL_BY_ID } from './animals';

describe('katalog hewan', () => {
  it('punya isi', () => {
    expect(ANIMALS.length).toBeGreaterThan(0);
  });

  it('id unik dan peta cocok dengan daftarnya', () => {
    const ids = ANIMALS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ANIMAL_BY_ID.size).toBe(ANIMALS.length);
    for (const a of ANIMALS) expect(ANIMAL_BY_ID.get(a.id)).toBe(a);
  });

  it('setiap hewan punya sekurangnya satu tugas', () => {
    for (const a of ANIMALS) {
      expect(a.tugas.length, `${a.id} tidak punya tugas`).toBeGreaterThan(0);
    }
  });

  it('kode tugas unik dalam satu hewan', () => {
    for (const a of ANIMALS) {
      const kode = a.tugas.map((t) => t.kode);
      expect(new Set(kode).size, `${a.id} punya kode tugas kembar`).toBe(kode.length);
    }
  });

  it('interval tugas positif dan mulaiHari tidak negatif', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.tiapHari, `${a.id}/${t.kode}`).toBeGreaterThan(0);
        expect(t.mulaiHari, `${a.id}/${t.kode}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('setiap tugas menjelaskan caranya, bukan cuma menamainya', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(t.cara.length, `${a.id}/${t.kode} terlalu pendek`).toBeGreaterThan(25);
      }
    }
  });

  it('tugas hanya bersasaran kandang atau hewan', () => {
    for (const a of ANIMALS) {
      for (const t of a.tugas) {
        expect(['kandang', 'hewan']).toContain(t.sasaran);
      }
    }
  });

  it('hewan air punya rentang pH, hewan darat tidak dipaksa punya', () => {
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      expect(a.phAir, `${a.id} tanpa phAir`).not.toBeNull();
      expect(a.phAir![0]).toBeLessThan(a.phAir![1]);
    }
  });

  it('hewan laut dan payau punya rentang salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-laut' && a.habitat !== 'air-payau') continue;
      expect(a.salinitasPpt, `${a.id} tanpa salinitas`).not.toBeNull();
      expect(a.salinitasPpt![0]).toBeLessThan(a.salinitasPpt![1]);
    }
  });

  it('hewan air tawar tidak punya salinitas', () => {
    for (const a of ANIMALS) {
      if (a.habitat !== 'air-tawar') continue;
      expect(a.salinitasPpt, `${a.id} punya salinitas padahal air tawar`).toBeNull();
    }
  });

  it('umur hidup masuk akal', () => {
    for (const a of ANIMALS) {
      expect(a.umurTahun[0]).toBeGreaterThan(0);
      expect(a.umurTahun[0]).toBeLessThanOrEqual(a.umurTahun[1]);
    }
  });

  it('kolom keselamatan selalu hadir sebagai keputusan', () => {
    // null pun harus disengaja. `in` membedakan "sengaja null" dari "lupa".
    for (const a of ANIMALS) {
      expect('legal' in a, `${a.id} tanpa kolom legal`).toBe(true);
      expect('bahaya' in a, `${a.id} tanpa kolom bahaya`).toBe(true);
    }
  });

  it('semua golongan yang dijanjikan sudah terwakili', () => {
    const grup = new Set(ANIMALS.map((a) => a.grup));
    for (const g of ['mamalia', 'unggas', 'ikan-tawar', 'ikan-laut', 'reptil']) {
      expect(grup.has(g as never), `belum ada ${g}`).toBe(true);
    }
  });

  it('jumlah spesies sesuai janji gelombang pertama', () => {
    expect(ANIMALS.length).toBeGreaterThanOrEqual(60);
  });

  it('tiap golongan punya cukup pilihan untuk berguna', () => {
    const per = new Map<string, number>();
    for (const a of ANIMALS) per.set(a.grup, (per.get(a.grup) ?? 0) + 1);
    for (const [grup, minimal] of [
      ['mamalia', 6], ['unggas', 10], ['ikan-tawar', 14],
      ['ikan-laut', 5], ['reptil', 6], ['ternak-besar', 4],
    ] as const) {
      expect(per.get(grup) ?? 0, `${grup} terlalu sedikit`).toBeGreaterThanOrEqual(minimal);
    }
  });

  it('tiap hewan berhabitat air punya tugas ganti air bersasaran kandang', () => {
    // Ikan yang tidak pernah ditagih ganti air adalah ikan yang mati pelan.
    for (const a of ANIMALS) {
      if (a.habitat === 'darat') continue;
      const ada = a.tugas.some((t) => t.sasaran === 'kandang' && /air/i.test(t.nama));
      expect(ada, `${a.id} tanpa tugas air`).toBe(true);
    }
  });

  it('tiap hewan punya sekurangnya satu tugas penting', () => {
    for (const a of ANIMALS) {
      expect(a.tugas.some((t) => t.penting), `${a.id} tanpa tugas penting`).toBe(true);
    }
  });

  it('reptil berjemur punya tugas ganti UVB', () => {
    // Lampu UVB berhenti memancarkan UVB jauh sebelum lampunya mati, jadi
    // "masih menyala" bukan tanda ia masih bekerja. Ini penyebab paling umum
    // cangkang bengkok pada kura-kura peliharaan.
    for (const a of ANIMALS) {
      if (a.grup !== 'reptil') continue;
      expect(a.tugas.some((t) => t.kode === 'uvb'), `${a.id} tanpa tugas uvb`).toBe(true);
    }
  });
});
