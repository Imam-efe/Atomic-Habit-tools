import { describe, it, expect } from 'vitest';
import { PLANTS } from '../data/plants';
import { resolveTerm, companionAdvice, findGardenConflicts } from './garden_companion';
import { seasonOfMonth, parseSeason, prefersEarlySeason, plantingCalendar } from './garden_season';
import { fitInArea, fitInBed, potFit } from './garden_space';

const byId = (id: string) => {
  const plant = PLANTS.find((p) => p.id === id);
  if (!plant) throw new Error(`tanaman contoh tidak ada di katalog: ${id}`);
  return plant;
};

describe('resolveTerm', () => {
  it('mencocokkan id persis', () => {
    expect(resolveTerm('kangkung', PLANTS)?.id).toBe('kangkung');
  });

  it('mencocokkan lewat awalan saat katalog memakai varietas', () => {
    // Daftar pendamping menulis 'sawi', katalog menyimpan 'sawi-hijau'.
    expect(resolveTerm('sawi', PLANTS)?.id).toBe('sawi-hijau');
  });

  it('tidak peduli huruf besar-kecil dan spasi berlebih', () => {
    expect(resolveTerm('  Kangkung  ', PLANTS)?.id).toBe('kangkung');
  });

  it('mengembalikan null untuk tanaman di luar katalog', () => {
    // marigold memang tidak ada di 66 tanaman katalog.
    expect(resolveTerm('marigold', PLANTS)).toBeNull();
  });

  it('mengembalikan null untuk istilah kosong', () => {
    expect(resolveTerm('   ', PLANTS)).toBeNull();
  });
});

describe('companionAdvice', () => {
  it('menandai pendamping yang sedang ditanam sebagai kecocokan', () => {
    const plant = PLANTS.find((p) => (p.companions ?? []).length > 0)!;
    const firstCompanion = resolveTerm(plant.companions[0], PLANTS);

    const advice = companionAdvice(plant, PLANTS, new Set([firstCompanion!.id]));

    expect(advice.matches.map((m) => m.plantId)).toContain(firstCompanion!.id);
    expect(advice.conflicts).toEqual([]);
  });

  it('menandai tanaman yang harus dijauhkan sebagai konflik saat ikut ditanam', () => {
    const plant = PLANTS.find((p) => (p.avoid ?? []).length > 0)!;
    const enemy = resolveTerm(plant.avoid[0], PLANTS);
    if (!enemy) return; // istilahnya di luar katalog, kasus itu diuji terpisah

    const advice = companionAdvice(plant, PLANTS, new Set([enemy.id]));
    expect(advice.conflicts.map((c) => c.plantId)).toContain(enemy.id);
  });

  it('tetap menampilkan istilah di luar katalog sebagai teks', () => {
    const withMarigold = PLANTS.find((p) => (p.companions ?? []).includes('marigold'));
    if (!withMarigold) return;

    const advice = companionAdvice(withMarigold, PLANTS, new Set());
    const ref = advice.good.find((g) => g.term === 'marigold');

    expect(ref).toBeDefined();
    expect(ref!.plantId).toBeNull();
    expect(ref!.label).toBe('marigold');
  });

  it('tidak menandai apa pun saat kebun kosong', () => {
    const plant = byId('kangkung');
    const advice = companionAdvice(plant, PLANTS, new Set());

    expect(advice.matches).toEqual([]);
    expect(advice.conflicts).toEqual([]);
  });
});

describe('findGardenConflicts', () => {
  it('melaporkan pasangan bertentangan sekali saja, bukan dua kali', () => {
    const plant = PLANTS.find((p) => (p.avoid ?? []).length > 0)!;
    const enemy = resolveTerm(plant.avoid[0], PLANTS);
    if (!enemy) return;

    const conflicts = findGardenConflicts([plant, enemy], PLANTS);
    // Satu masalah bagi pengguna, jadi satu temuan — bukan A-lawan-B dan B-lawan-A.
    expect(conflicts).toHaveLength(1);
  });

  it('kosong saat tidak ada yang bertentangan', () => {
    expect(findGardenConflicts([byId('kangkung')], PLANTS)).toEqual([]);
  });
});

describe('seasonOfMonth', () => {
  it('memetakan Oktober sampai Maret sebagai musim hujan', () => {
    for (const m of [10, 11, 12, 1, 2, 3]) expect(seasonOfMonth(m)).toBe('hujan');
  });

  it('memetakan April sampai September sebagai kemarau', () => {
    for (const m of [4, 5, 6, 7, 8, 9]) expect(seasonOfMonth(m)).toBe('kemarau');
  });
});

describe('parseSeason', () => {
  it('mengenali kosakata katalog', () => {
    expect(parseSeason('Awal musim hujan')).toEqual(['hujan']);
    expect(parseSeason('Kemarau')).toEqual(['kemarau']);
    expect(parseSeason('Sepanjang tahun')).toEqual(['sepanjang-tahun']);
  });

  it('mengenali gabungan', () => {
    expect(parseSeason('Awal kemarau atau awal hujan')).toEqual(
      expect.arrayContaining(['hujan', 'kemarau'])
    );
  });

  it('jatuh ke sepanjang tahun untuk teks tak dikenal', () => {
    // Lebih baik muncul di kalender daripada hilang selamanya.
    expect(parseSeason('entah kapan')).toEqual(['sepanjang-tahun']);
  });

  it('mendeteksi anjuran menanam di awal musim', () => {
    expect(prefersEarlySeason('Awal musim hujan')).toBe(true);
    expect(prefersEarlySeason('Kemarau')).toBe(false);
  });
});

describe('plantingCalendar', () => {
  it('mendahulukan yang musimnya persis cocok', () => {
    const januari = plantingCalendar(PLANTS, 1); // musim hujan
    expect(januari.length).toBeGreaterThan(0);
    expect(januari[0].fit).toBe('ideal');
  });

  it('menandai tanaman sepanjang tahun sebagai bisa, bukan ideal', () => {
    const juli = plantingCalendar(PLANTS, 7);
    const anytime = juli.find((w) => w.season.toLowerCase().startsWith('sepanjang tahun') && w.fit === 'bisa');
    expect(anytime).toBeDefined();
  });

  it('mengurutkan yang cepat panen lebih dulu dalam kelompok yang sama', () => {
    const cal = plantingCalendar(PLANTS, 1).filter((w) => w.fit === 'ideal');
    for (let i = 1; i < cal.length; i++) {
      expect(cal[i].daysToHarvest[0]).toBeGreaterThanOrEqual(cal[i - 1].daysToHarvest[0]);
    }
  });

  it('tidak pernah mengosongkan kalender di bulan mana pun', () => {
    for (let m = 1; m <= 12; m++) {
      expect(plantingCalendar(PLANTS, m).length).toBeGreaterThan(0);
    }
  });
});

describe('fitInArea / fitInBed', () => {
  it('menghitung jumlah dari luas per tanaman', () => {
    const plant = byId('kangkung'); // jarak 10 cm
    // 1 m2 dibagi (0,1 x 0,1) = 100 tanaman.
    expect(fitInArea(plant, 1).count).toBe(100);
  });

  it('membulatkan ke bawah, tidak pernah menjanjikan lebih dari yang muat', () => {
    const plant = byId('kangkung');
    expect(fitInArea(plant, 0.15).count).toBe(15);
  });

  it('memberi pola baris kali kolom untuk bedengan', () => {
    const plant = byId('kangkung');
    const fit = fitInBed(plant, 2, 1); // 2 m x 1 m, jarak 10 cm

    expect(fit.layout).toEqual({ rows: 10, cols: 20 });
    expect(fit.count).toBe(200);
  });

  it('mengembalikan nol untuk bedengan yang lebih sempit dari jaraknya', () => {
    const plant = byId('kangkung');
    expect(fitInBed(plant, 0.05, 0.05).count).toBe(0);
  });
});

describe('potFit', () => {
  it('menolak pot yang lebih kecil dari kebutuhan minimum', () => {
    const plant = PLANTS.find((p) => p.potLiter >= 10)!;
    const verdict = potFit(plant, 5);

    expect(verdict.fits).toBe(false);
    expect(verdict.message).toContain('kurang');
    expect(verdict.message).toContain(String(plant.potLiter));
  });

  it('menerima pot yang pas', () => {
    const plant = byId('kangkung');
    const verdict = potFit(plant, plant.potLiter);

    expect(verdict.fits).toBe(true);
    expect(verdict.perPot).toBe(1);
  });

  it('menghitung berapa yang muat di pot besar, tanpa membulatkan ke atas', () => {
    const plant = byId('kangkung'); // 5 liter
    const verdict = potFit(plant, 12);

    // 12 dibagi 5 = 2 tanaman, bukan 3 — sisa 2 liter tidak cukup untuk satu lagi.
    expect(verdict.perPot).toBe(2);
  });
});
