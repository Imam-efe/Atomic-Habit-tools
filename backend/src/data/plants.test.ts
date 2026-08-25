/**
 * Uji katalog tanaman.
 *
 * Yang diuji bukan isi tiap entri — angka hortikultura tidak bisa dibuktikan
 * oleh uji — melainkan sifat yang harus berlaku di seluruh katalog, dan yang
 * kalau dilanggar membuat fitur lain salah tanpa satu pun pesan galat.
 *
 * Yang paling penting di antaranya: tanaman hias tidak boleh punya umur panen.
 * Satu entri yang keliru saja sudah cukup untuk membuat aplikasi mengumumkan
 * "mawarmu siap panen", mengirim pengingat panen, dan memasukkan mawar ke
 * hitungan HPP per kilogram.
 */

import { describe, it, expect } from 'vitest';
import {
  PLANTS, PLANT_BY_ID, CATEGORY_LABELS, CATEGORY_PANEN,
  dipanen, tanamanHias, type PlantCategory,
} from './plants';

describe('katalog tanaman', () => {
  it('id-nya unik', () => {
    expect(PLANT_BY_ID.size).toBe(PLANTS.length);
  });

  it('id-nya berupa slug yang aman dipakai sebagai kunci', () => {
    for (const p of PLANTS) expect(p.id, p.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('semua kategorinya punya label', () => {
    for (const p of PLANTS) expect(CATEGORY_LABELS[p.category], p.id).toBeTruthy();
  });

  it('tiap kategori berlabel benar-benar terpakai', () => {
    // Label untuk kategori yang tidak ada isinya akan tampil sebagai tab
    // kosong di layar katalog.
    const terpakai = new Set(PLANTS.map((p) => p.category));
    for (const kategori of Object.keys(CATEGORY_LABELS) as PlantCategory[]) {
      expect(terpakai.has(kategori), kategori).toBe(true);
    }
  });
});

describe('tanaman pangan', () => {
  const pangan = PLANTS.filter((p) => CATEGORY_PANEN.includes(p.category));

  it('semuanya punya umur panen', () => {
    for (const p of pangan) expect(dipanen(p), p.id).toBe(true);
  });

  it('rentang umur panennya urut dan masuk akal', () => {
    for (const p of pangan) {
      if (!dipanen(p)) continue;
      const [min, max] = p.daysToHarvest;
      expect(min, p.id).toBeGreaterThan(0);
      expect(max, p.id).toBeGreaterThanOrEqual(min);
      // Sepuluh tahun. Di atas itu hampir pasti salah satuan.
      expect(max, p.id).toBeLessThanOrEqual(3650);
    }
  });

  it('jarak panen berulang hanya diisi oleh yang memang panen berulang', () => {
    for (const p of PLANTS) {
      if (p.repeatHarvest) expect(p.harvestEveryDays, p.id).toBeGreaterThan(0);
      else expect(p.harvestEveryDays, p.id).toBeNull();
    }
  });

  it('tidak ada yang ditandai sebagai tanaman hias', () => {
    for (const p of pangan) expect(tanamanHias(p), p.id).toBe(false);
  });
});

describe('tanaman hias', () => {
  const hias = PLANTS.filter(tanamanHias);

  it('ada isinya', () => {
    expect(hias.length).toBeGreaterThan(0);
  });

  it('tidak satu pun punya umur panen', () => {
    // Ini uji yang paling menentukan di berkas ini: umur panen pada tanaman
    // hias menyalakan penanda siap panen, pengingat panen, perkiraan panen,
    // dan HPP sekaligus.
    for (const p of hias) {
      expect(p.daysToHarvest, p.id).toBeNull();
      expect(dipanen(p), p.id).toBe(false);
    }
  });

  it('tidak dijadwalkan panen berulang', () => {
    for (const p of hias) {
      expect(p.repeatHarvest, p.id).toBe(false);
      expect(p.harvestEveryDays, p.id).toBeNull();
    }
  });

  it('kategorinya termasuk kategori hias', () => {
    for (const p of hias) {
      expect(CATEGORY_PANEN.includes(p.category), p.id).toBe(false);
    }
  });

  it('yang beracun selalu menjelaskan racunnya', () => {
    // "Beracun" tanpa keterangan tidak membantu siapa pun memutuskan apakah
    // tanaman ini boleh ada di ruang tamu yang ada balitanya.
    for (const p of hias) {
      if (p.ornamental?.toxic) {
        expect(p.ornamental.toxicNote.length, p.id).toBeGreaterThan(20);
      }
    }
  });

  it('yang tidak beracun pun menyebutkannya', () => {
    for (const p of hias) {
      expect(p.ornamental?.toxicNote, p.id).toBeTruthy();
    }
  });

  it('punya catatan perawatan rutin', () => {
    for (const p of hias) expect(p.ornamental?.grooming, p.id).toBeTruthy();
  });

  it('tidak menjanjikan bunga lewat teks kosong', () => {
    // `bloom` null berarti ditanam untuk daunnya; string kosong akan tampil
    // sebagai janji berbunga yang isinya tidak ada.
    for (const p of hias) {
      const bloom = p.ornamental?.bloom;
      expect(bloom === null || (typeof bloom === 'string' && bloom.length > 0), p.id).toBe(true);
    }
  });

  it('interval siram sukulen lebih panjang daripada tanaman hias daun', () => {
    // Sukulen jauh lebih sering mati karena kelebihan air, dan jadwal siram
    // yang terlalu rajin adalah cara aplikasi ini ikut membunuhnya.
    const sukulen = hias.filter((p) => p.category === 'sukulen');
    const daun = hias.filter((p) => p.category === 'hias-daun');
    expect(sukulen.length).toBeGreaterThan(0);

    const palingSeringSukulen = Math.min(...sukulen.map((p) => p.waterIntervalDays));
    const rataDaun = daun.reduce((a, p) => a + p.waterIntervalDays, 0) / daun.length;
    expect(palingSeringSukulen).toBeGreaterThan(rataDaun);
  });
});

describe('semua tanaman', () => {
  it('punya interval siram dan pupuk yang bisa dijadwalkan', () => {
    for (const p of PLANTS) {
      expect(p.waterIntervalDays, p.id).toBeGreaterThan(0);
      expect(p.fertilizeIntervalDays, p.id).toBeGreaterThan(0);
    }
  });

  it('punya nama, nama latin, dan emoji', () => {
    for (const p of PLANTS) {
      expect(p.name, p.id).toBeTruthy();
      expect(p.latinName, p.id).toBeTruthy();
      expect(p.emoji, p.id).toBeTruthy();
    }
  });

  it('rentang pH-nya urut', () => {
    for (const p of PLANTS) {
      expect(p.phRange[1], p.id).toBeGreaterThanOrEqual(p.phRange[0]);
    }
  });

  it('istilah pendamping dan pantangan menunjuk id yang ada, atau memang teks bebas', () => {
    // Yang tidak boleh: id yang salah ketik. Itu tampil sebagai teks biasa dan
    // tidak pernah ketahuan.
    const ids = new Set(PLANTS.map((p) => p.id));
    for (const p of PLANTS) {
      for (const term of [...p.companions, ...p.avoid]) {
        expect(term.trim().length, `${p.id} -> "${term}"`).toBeGreaterThan(0);
        // Kalau bentuknya slug, ia harus benar-benar ada.
        if (/^[a-z0-9-]+$/.test(term) && term.includes('-')) {
          expect(ids.has(term), `${p.id} -> ${term}`).toBe(true);
        }
      }
    }
  });
});
