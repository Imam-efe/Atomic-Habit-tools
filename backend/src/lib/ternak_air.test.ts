/**
 * Uji penilaian air.
 *
 * Satu aturan di sini tidak boleh pernah lunak: amonia di atas nol selalu
 * bahaya, untuk semua habitat. Tidak ada kadar amonia yang aman, dan itu
 * penyebab kematian ikan nomor satu di akuarium yang belum matang siklus
 * nitrogennya.
 */
import { describe, it, expect } from 'vitest';
import { nilaiAir, type HasilAir } from './ternak_air';
import type { Animal } from '../data/animals';

const ikanTawar = {
  id: 'koi', habitat: 'air-tawar', suhuC: [20, 28], phAir: [7.0, 8.5], salinitasPpt: null,
} as unknown as Animal;

const ikanLaut = {
  id: 'ikan-badut', habitat: 'air-laut', suhuC: [24, 28], phAir: [8.0, 8.4], salinitasPpt: [33, 35],
} as unknown as Animal;

const kosong: HasilAir = {
  suhuC: null, ph: null, amoniaPpm: null, nitritPpm: null, nitratPpm: null, salinitasPpt: null,
};

const cari = (r: ReturnType<typeof nilaiAir>, p: string) => r.find((x) => x.parameter === p);

describe('amonia', () => {
  it('di atas nol selalu bahaya, air tawar maupun laut', () => {
    for (const a of [ikanTawar, ikanLaut]) {
      const r = nilaiAir({ ...kosong, amoniaPpm: 0.25 }, a);
      expect(cari(r, 'amonia')!.status).toBe('bahaya');
    }
  });

  it('nol persis dinilai aman', () => {
    const r = nilaiAir({ ...kosong, amoniaPpm: 0 }, ikanTawar);
    expect(cari(r, 'amonia')!.status).toBe('aman');
  });
});

describe('nitrit dan nitrat', () => {
  it('nitrit di atas nol bahaya', () => {
    const r = nilaiAir({ ...kosong, nitritPpm: 0.5 }, ikanTawar);
    expect(cari(r, 'nitrit')!.status).toBe('bahaya');
  });

  it('nitrat tinggi cuma waspada, bukan bahaya', () => {
    // Nitrat adalah ujung siklus nitrogen dan ditoleransi jauh lebih tinggi;
    // menyamakannya dengan amonia membuat peringatan bahaya kehilangan arti.
    const r = nilaiAir({ ...kosong, nitratPpm: 60 }, ikanTawar);
    expect(cari(r, 'nitrat')!.status).toBe('waspada');
  });
});

describe('rentang katalog', () => {
  it('pH di dalam rentang aman, di luar rentang waspada', () => {
    expect(cari(nilaiAir({ ...kosong, ph: 7.5 }, ikanTawar), 'pH')!.status).toBe('aman');
    expect(cari(nilaiAir({ ...kosong, ph: 6.0 }, ikanTawar), 'pH')!.status).toBe('waspada');
  });

  it('suhu di luar rentang waspada', () => {
    expect(cari(nilaiAir({ ...kosong, suhuC: 32 }, ikanTawar), 'suhu')!.status).toBe('waspada');
  });

  it('salinitas dinilai hanya bila katalog menyebutnya', () => {
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 34 }, ikanLaut), 'salinitas')!.status).toBe('aman');
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 20 }, ikanLaut), 'salinitas')!.status).toBe('waspada');
    expect(cari(nilaiAir({ ...kosong, salinitasPpt: 34 }, ikanTawar), 'salinitas')).toBeUndefined();
  });
});

describe('data yang tidak ada', () => {
  it('parameter kosong tidak dinilai sama sekali', () => {
    expect(nilaiAir(kosong, ikanTawar)).toEqual([]);
  });

  it('tanpa katalog, amonia dan nitrit tetap dinilai', () => {
    // Ambangnya nol dan berlaku universal, jadi ia tidak butuh katalog.
    // pH dan suhu butuh rentang, jadi keduanya dilewati.
    const r = nilaiAir({ ...kosong, amoniaPpm: 1, ph: 6 }, null);
    expect(cari(r, 'amonia')!.status).toBe('bahaya');
    expect(cari(r, 'pH')).toBeUndefined();
  });
});

describe('saran', () => {
  it('setiap temuan membawa saran yang bisa dikerjakan', () => {
    const r = nilaiAir({ ...kosong, amoniaPpm: 1, nitritPpm: 1, ph: 5, suhuC: 35 }, ikanTawar);
    for (const p of r) {
      if (p.status === 'aman') continue;
      expect(p.saran.length, p.parameter).toBeGreaterThan(20);
    }
  });
});
