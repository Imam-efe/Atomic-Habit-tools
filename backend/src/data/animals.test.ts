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
});
